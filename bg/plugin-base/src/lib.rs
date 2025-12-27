mod bindings {
    wit_bindgen::generate!({
        path: "wit",
        world: "starstream:bg-plugin-base/sandbox",
        with: {
            "wasi:io/poll@0.2.0": ::wasi::io::poll,
            "wasi:graphics-context/graphics-context@0.0.1": generate,
            "wasi:surface/surface@0.0.1": generate,
            "wasi:webgpu/webgpu@0.0.1": generate,
            "wasi:clocks/monotonic-clock@0.2.0": ::wasi::clocks::monotonic_clock,
            "starstream:utils/loopback@0.2.0": generate,
        },
    });
    use super::PluginBase;
    export!(PluginBase);
}

use bindings::wasi::{graphics_context::graphics_context, surface::surface, webgpu::webgpu};
use bindings::starstream::utils::loopback;
use std::sync::Mutex;

struct PluginBase;

impl ::wasi::exports::cli::run::Guest for PluginBase {
    fn run() -> Result<(), ()>{
        *FORCE_RENDER_COND_VAR.lock().unwrap() = Some(loopback::register_loopback());
        // Wrap render loop in panic handler to prevent WASM crashes
        // Careful: this won't catch all GPU issues
        //          ex: https://developer.mozilla.org/en-US/docs/Web/API/GPUDevice/uncapturederror_event
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            start_render_loop();
        }));
        
        if result.is_err() {
            print("FATAL ERROR: draw_triangle panicked. This is a critical error.");
        }
        Ok(())
    }
}
::wasi::cli::command::export!(PluginBase);

// Queued shader code to render on next force re-render
static SHADER_STATE: Mutex<Option<String>> = Mutex::new(None);
// Force a re-render once some setting changes have been queued
static FORCE_RENDER_COND_VAR: Mutex<Option<loopback::ConditionVariable>> = Mutex::new(None);

impl bindings::Guest for PluginBase {
    fn queue_shader(shader_code: String) {
        *SHADER_STATE.lock().unwrap() = Some(shader_code);
        // (should always be the case) only notify if the cond var has been initialized by run()
        let guard = FORCE_RENDER_COND_VAR.lock().unwrap();
        if let Some(ref cond_var) = guard.as_ref() {
            cond_var.notify();
        }
    }
}

/// throttle the animation to a constant refresh rate
const TARGET_FPS: u64 = 30; // events per second
const NS_PER_SECOND: u64 = 1_000_000_000;
const DURATION_PER_FRAME: u64 = NS_PER_SECOND / TARGET_FPS;

// Standard uniform declaration (minimal - just size)
// follows same format as WebGPU Shader toy
const STANDARD_UNIFORMS: &str = r#"
struct Uniforms {
    size: vec4<f32>,
    mouse: vec4<f32>,
    time:  f32,
    frame: i32,
}

@group(0) @binding(0)
var<uniform> inputs: Uniforms;
"#;

/// Uniforms struct: size (vec4<f32>) + mouse (vec4<f32>) + time (f32) + frame (i32) = 40 bytes
/// Aligned to 16 bytes per WebGPU spec, so we need 48 bytes total
const UNIFORM_BUFFER_SIZE: usize = 48;

/// Full-screen quad vertex shader
/// Creates a quad covering the entire screen using vertex_index
/// Uses 6 vertices (2 triangles) to form a full-screen quad
const FULL_SCREEN_VERTEX_SHADER: &str = r#"
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    var positions = array<vec2<f32>, 6>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(-1.0, 1.0),
        vec2<f32>(1.0, -1.0),
        vec2<f32>(1.0, 1.0),
    );

    return vec4<f32>(positions[in_vertex_index], 0.0, 1.0);
}
"#;

/// Default fragment shader
/// Grey so that it's neither black nor white (makes it easy to tell the code ran properly both on dark mode and light mode)
const DEFAULT_FRAGMENT_SHADER: &str = r#"
@fragment
fn fragmentMain(@builtin(position) pos: vec4<f32>) -> @location(0) vec4<f32> {
    return vec4<f32>(0.5, 0.5, 0.5, 1.0);
}
"#;

/// Preprocesses user-submitted shader code to ensure compatibility with the plugin system.
fn preprocess_shader(user_code: &str) -> String {
    let processed_code = user_code.trim();
    return format!("{}\n{}\n{}", STANDARD_UNIFORMS, FULL_SCREEN_VERTEX_SHADER, processed_code);
}

/// Checks if the shader code uses the mouse uniform.
fn shader_uses_mouse(shader_code: &str) -> bool {
    shader_code.contains("inputs.mouse")
}

/// Checks if the shader code uses time or frame uniforms.
fn shader_uses_time_or_frame(shader_code: &str) -> bool {
    shader_code.contains("inputs.time") || shader_code.contains("inputs.frame")
}

/// Event types that can be polled
#[derive(Clone, Copy, PartialEq, Eq)]
enum EventType {
    PointerMove,
    Resize,
    Frame,
    ForceRender,
}

/// Renders a frame with the given uniforms
fn render_frame(
    device: &webgpu::GpuDevice,
    graphics_context: &graphics_context::Context,
    uniform_buffer: &webgpu::GpuBuffer,
    bind_group: &webgpu::GpuBindGroup,
    pipeline: &webgpu::GpuRenderPipeline,
    size: (f32, f32, f32, f32),
    mouse_pos: (f32, f32, f32, f32),
    initial_time: u64,
    frame_count: &i32,
) {
    let time_delta = ::wasi::clocks::monotonic_clock::now() - initial_time;
    // uniform expects time as a fractional "second" resolution
    let time = time_delta as f32 / 1_000_000_000.0;

    let mut uniform_data = vec![0u8; UNIFORM_BUFFER_SIZE];
    
    // size: vec4<f32> at offset 0
    uniform_data[0..4].copy_from_slice(&size.0.to_le_bytes());
    uniform_data[4..8].copy_from_slice(&size.1.to_le_bytes());
    uniform_data[8..12].copy_from_slice(&size.2.to_le_bytes());
    uniform_data[12..16].copy_from_slice(&size.3.to_le_bytes());
    
    // mouse: vec4<f32> at offset 16
    uniform_data[16..20].copy_from_slice(&mouse_pos.0.to_le_bytes());
    uniform_data[20..24].copy_from_slice(&mouse_pos.1.to_le_bytes());
    uniform_data[24..28].copy_from_slice(&mouse_pos.2.to_le_bytes());
    uniform_data[28..32].copy_from_slice(&mouse_pos.3.to_le_bytes());
    
    // time: f32 at offset 32
    uniform_data[32..36].copy_from_slice(&time.to_le_bytes());
    
    // frame: i32 at offset 36
    uniform_data[36..40].copy_from_slice(&frame_count.to_le_bytes());

    let graphics_buffer = graphics_context.get_current_buffer();
    let texture = webgpu::GpuTexture::from_graphics_buffer(graphics_buffer);
    let view = texture.create_view(None);
    let encoder = device.create_command_encoder(None);

    // Write uniform data to buffer
    let _ = device.queue().write_buffer_with_copy(&uniform_buffer, 0, &uniform_data, None, None);

    // Render - wrap in block for proper lifetime management
    {
        let render_pass_description = webgpu::GpuRenderPassDescriptor {
            label: None,
            color_attachments: vec![Some(webgpu::GpuRenderPassColorAttachment {
                view: &view,
                depth_slice: None,
                resolve_target: None,
                clear_value: Some(webgpu::GpuColor {
                    r: 0.0,
                    g: 0.0,
                    b: 0.0,
                    a: 1.0,
                }),
                load_op: webgpu::GpuLoadOp::Clear,
                store_op: webgpu::GpuStoreOp::Store,
            })],
            depth_stencil_attachment: None,
            occlusion_query_set: None,
            timestamp_writes: None,
            max_draw_count: None,
        };
        let render_pass = encoder.begin_render_pass(&render_pass_description);

        render_pass.set_pipeline(&pipeline);
        let _ = render_pass.set_bind_group(0, Some(&bind_group), None, None, None);
        render_pass.draw(6, None, None, None); // 6 vertices for full-screen quad
        render_pass.end();
    }

    device.queue().submit(&[&encoder.finish(None)]);
    graphics_context.present();
}

fn get_shader_code() -> String {
    let shader_state = SHADER_STATE.lock().unwrap();
    let shader_to_use = match shader_state.as_ref() {
        Some(s) => s.clone(),
        None => DEFAULT_FRAGMENT_SHADER.to_string(),
    };

    let shader_code = preprocess_shader(&shader_to_use);
    shader_code
}
fn create_pipeline(device: &webgpu::GpuDevice, bind_group_layout: &webgpu::GpuBindGroupLayout, shader_code: String) -> webgpu::GpuRenderPipeline {
    // Create pipeline layout
    let pipeline_layout = device.create_pipeline_layout(&webgpu::GpuPipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: vec![Some(&bind_group_layout)],
    });

    let vertex_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
        code: shader_code.clone(),
        label: None,
        compilation_hints: None,
    });
    let fragment_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
        code: shader_code.clone(),
        label: None,
        compilation_hints: None,
    });

    // Create render pipeline
    let vertex = webgpu::GpuVertexState {
        module: &vertex_module,
        entry_point: Some("vs_main".to_string()),
        buffers: None,
        constants: None,
    };
    let fragment = webgpu::GpuFragmentState {
        module: &fragment_module,
        entry_point: Some("fragmentMain".to_string()),
        targets: vec![Some(webgpu::GpuColorTargetState {
            format: webgpu::GpuTextureFormat::Bgra8unorm,
            blend: Some(webgpu::GpuBlendState {
                color: webgpu::GpuBlendComponent {
                    src_factor: Some(webgpu::GpuBlendFactor::SrcAlpha),
                    dst_factor: Some(webgpu::GpuBlendFactor::OneMinusSrcAlpha),
                    operation: Some(webgpu::GpuBlendOperation::Add),
                },
                alpha: webgpu::GpuBlendComponent {
                    src_factor: Some(webgpu::GpuBlendFactor::One),
                    dst_factor: Some(webgpu::GpuBlendFactor::OneMinusSrcAlpha),
                    operation: Some(webgpu::GpuBlendOperation::Add),
                },
            }),
            write_mask: Some(0xF), // All color channels (R=0x1, G=0x2, B=0x4, A=0x8, ALL=0xF)
        })],
        constants: None,
    };
    let pipeline = device.create_render_pipeline(webgpu::GpuRenderPipelineDescriptor {
        label: None,
        vertex,
        fragment: Some(fragment),
        primitive: Some(webgpu::GpuPrimitiveState {
            topology: Some(webgpu::GpuPrimitiveTopology::TriangleList),
            strip_index_format: None,
            front_face: None,
            cull_mode: None,
            unclipped_depth: None,
        }),
        depth_stencil: None,
        multisample: None,
        layout: webgpu::GpuLayoutMode::Specific(&pipeline_layout),
    });
    pipeline
}

fn start_render_loop() {
    let gpu = webgpu::get_gpu();
    let adapter = match gpu.request_adapter(None) {
        Some(a) => a,
        None => return, // No adapter available
    };
    let device = match adapter.request_device(None) {
        Ok(d) => d,
        Err(_) => return, // No device available
    };

    let canvas = surface::Surface::new(surface::CreateDesc {
        height: None,
        width: None,
    });
    let graphics_context = graphics_context::Context::new();
    canvas.connect_graphics_context(&graphics_context);
    device.connect_graphics_context(&graphics_context);

    // Track for uniforms
    let mut size = (800.0f32, 600.0f32, 800.0f32 / 600.0f32, 0.0f32); // width, height, aspect_ratio, unused
    let mut mouse_pos = (0.0f32, 0.0f32, 0.0f32, 0.0f32); // x, y, unused, unused
    // spec doesn't guarantee monotonic_clock starts at 0, so we manually adjust
    let initial_time = ::wasi::clocks::monotonic_clock::now();
    let mut frame_count: i32 = 0;

    // Subscribe to host events
    let pointer_move_pollable = canvas.subscribe_pointer_move();
    let resize_pollable = canvas.subscribe_resize();
    // note: do not use `subscribe_frame` from wasi-gfx
    //       as its JS host implementation triggers an event based on the host's refresh rate
    //       https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
    // let frame_pollable = canvas.subscribe_frame();
    // TODO: unlike the JS implementation of subscribe_frame, this doesn't pause when the tab is not visible
    //       probably best to move to subscribe_frame once better refresh rates are handled
    //       see: https://github.com/WebAssembly/wasi-gfx/issues/60
    let mut frame_pollable = ::wasi::clocks::monotonic_clock::subscribe_duration(DURATION_PER_FRAME);

    let uniform_buffer = device.create_buffer(&webgpu::GpuBufferDescriptor {
        label: Some("Uniforms".to_string()),
        size: UNIFORM_BUFFER_SIZE as u64,
        usage: 0x0040 | 0x0008, // uniform | copy_dst
        mapped_at_creation: None,
    });

    // Create bind group layout
    let bind_group_layout = device.create_bind_group_layout(&webgpu::GpuBindGroupLayoutDescriptor {
        label: Some("Uniforms Bind Group Layout".to_string()),
        entries: vec![webgpu::GpuBindGroupLayoutEntry {
            binding: 0,
            visibility: 0x0001 | 0x0002, // vertex | fragment
            buffer: Some(webgpu::GpuBufferBindingLayout {
                type_: Some(webgpu::GpuBufferBindingType::Uniform),
                has_dynamic_offset: None,
                min_binding_size: Some(UNIFORM_BUFFER_SIZE as u64),
            }),
            sampler: None,
            texture: None,
            storage_texture: None,
        }],
    });

    // Create bind group
    let bind_group = device.create_bind_group(&webgpu::GpuBindGroupDescriptor {
        label: Some("Uniforms Bind Group".to_string()),
        layout: &bind_group_layout,
        entries: vec![webgpu::GpuBindGroupEntry {
            binding: 0,
            resource: webgpu::GpuBindingResource::GpuBufferBinding(webgpu::GpuBufferBinding {
                buffer: &uniform_buffer,
                offset: None,
                size: None,
            }),
        }],
    });

    let mut shader_code = get_shader_code();
    let mut pipeline = create_pipeline(&device, &bind_group_layout, shader_code.clone());
    // Main render loop
    loop {
        // Build pollables vector conditionally based on what the shader actually needs
        // this avoids needless computational overhead
        // ex: updating mouse position for shaders that don't use the mouse
        let (poll_result, index_to_event) = {
            let mut pollables = Vec::new();
            let mut index_to_event: Vec<EventType> = Vec::new();
            
            // Check which uniforms the shader uses to conditionally include polling
            let uses_mouse = shader_uses_mouse(&shader_code);
            if uses_mouse {
                pollables.push(&pointer_move_pollable);
                index_to_event.push(EventType::PointerMove);
            }
            
            // Resize is always needed
            pollables.push(&resize_pollable);
            index_to_event.push(EventType::Resize);
            
            let uses_time_or_frame = shader_uses_time_or_frame(&shader_code);
            if uses_time_or_frame {
                pollables.push(&frame_pollable);
                index_to_event.push(EventType::Frame);
            }

            // If the host queued some setting updates for us to process
            let force_render_pollable = {
                // note: explicitly scope acquiring lock to this block
                // so that it's released before we enter `poll::poll`
                let guard = FORCE_RENDER_COND_VAR.lock().unwrap();
                guard.as_ref().map(|cond_var| cond_var.as_pollable())
            };
            if let Some(ref pollable) = force_render_pollable {
                pollables.push(pollable);
                index_to_event.push(EventType::ForceRender);
            }
            
            // Check for events in a blocking way
            let result = ::wasi::io::poll::poll(&pollables);
            
            (result, index_to_event)
        };
        
        let mut need_render = false;

        // Process events based on the mapping
        for (index, event_type) in index_to_event.iter().enumerate() {
            if poll_result.contains(&(index as u32)) {
                match event_type {
                    EventType::PointerMove => {
                        let event = canvas.get_pointer_move();
                        if let Some(e) = event {
                            mouse_pos = (e.x as f32, e.y as f32, 0.0, 0.0);
                            need_render = true;
                        }
                    }
                    EventType::Resize => {
                        if let Some(event) = canvas.get_resize() {
                            let width = event.width as f32;
                            let height = event.height as f32;
                            // Calculate aspect ratio (width/height), avoiding division by zero
                            let aspect = if height > 0.0 { width / height } else { 1.0 };
                            size = (width, height, aspect, 0.0);
                            canvas.request_set_size(Some(event.height), Some(event.width));
                            need_render = true;
                        }
                    }
                    EventType::Frame => {
                        frame_count += 1;
                        need_render = true;
                    }
                    EventType::ForceRender => {
                        need_render = true;
                        shader_code = get_shader_code();
                        pipeline = create_pipeline(&device, &bind_group_layout, shader_code.clone());
                    }
                }
            }
        }

        if need_render {
            // start a timer for the next frame
            frame_pollable = ::wasi::clocks::monotonic_clock::subscribe_duration(DURATION_PER_FRAME);
            render_frame(&device, &graphics_context, &uniform_buffer, &bind_group, &pipeline, size, mouse_pos, initial_time, &frame_count);
        }
    }
}

fn print(s: &str) {
    let stdout = ::wasi::cli::stdout::get_stdout();
    stdout.blocking_write_and_flush(s.as_bytes()).unwrap();
    stdout.blocking_write_and_flush(b"\n").unwrap();
}
