mod bindings {
    // putting in separate module to avoid clash with other wasi crate
    wit_bindgen::generate!({
        path: "wit",
        world: "starstream:bg-plugin-base/sandbox",
        // generate_all,
        with: {
            "wasi:io/poll@0.2.0": ::wasi::io::poll,
            // "wasi:graphics-context/graphics-context": generate,
            // "wasi:surface/surface": generate,
            // "wasi:webgpu/webgpu": generate,
            "wasi:graphics-context/graphics-context@0.0.1": generate,
            "wasi:surface/surface@0.0.1": generate,
            "wasi:webgpu/webgpu@0.0.1": generate,
        },
    });
    use super::PluginBase;
    export!(PluginBase);
}

use bindings::wasi::{graphics_context::graphics_context, surface::surface, webgpu::webgpu};
use std::sync::Mutex;

struct PluginBase;

// Shared state for shader code that can be updated from multiple functions
static SHADER_STATE: Mutex<Option<String>> = Mutex::new(None);

impl bindings::Guest for PluginBase {
    fn run(input: String) {
        print("=== WASM run() called ===");
        print(&format!("Input shader length: {}", input.len()));
        
        // Initialize shader from input, or use default if empty
        let initial_shader = if input.is_empty() {
            get_default_shader().to_string()
        } else {
            input
        };
        
        print("Setting shader state...");
        // Set the initial shader in shared state
        *SHADER_STATE.lock().unwrap() = Some(initial_shader);
        
        print("Calling draw_triangle()...");
        // Wrap draw_triangle in a panic handler to prevent WASM crashes
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            draw_triangle();
        }));
        
        if result.is_err() {
            print("FATAL ERROR: draw_triangle panicked. This is a critical error.");
        } else {
            print("draw_triangle() returned (this shouldn't happen - it has an infinite loop)");
        }
    }
    
    fn update_shader(shader_code: String) {
        // Update the shader code in shared state
        *SHADER_STATE.lock().unwrap() = Some(shader_code);
    }
}

const DEFAULT_SHADER: &str = r#"
@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    return vec4f(pos.xy / inputs.size.xy, 0.5, 1);
}
"#;

fn get_default_shader() -> &'static str {
    DEFAULT_SHADER
}

// Standard uniform declaration that must be present in all shaders
const STANDARD_UNIFORMS: &str = r#"
struct Uniforms {
    size:  vec4<f32>,
    mouse: vec4<f32>,
    time:  f32,
    frame: i32,
}

@group(0) @binding(0)
var<uniform> uniforms: Uniforms;
"#;

// Standard vertex shader for Shadertoy-style fragment-only shaders
const STANDARD_VERTEX_SHADER: &str = r#"
@vertex
fn vs_main(@builtin(vertex_index) in_vertex_index: u32) -> @builtin(position) vec4<f32> {
    let x = f32(i32(in_vertex_index) - 1);
    let y = f32(i32(in_vertex_index & 1u) * 2 - 1);
    return vec4<f32>(x, y, 0.0, 1.0);
}
"#;

/// Detects the fragment shader entry point name from shader code.
/// Looks for @fragment functions and returns the function name, or "fs_main" as default.
fn detect_fragment_entry_point(code: &str) -> String {
    // Look for @fragment followed by fn <name>
    let lines: Vec<&str> = code.lines().collect();
    let mut i = 0;
    while i < lines.len() {
        let line = lines[i].trim();
        if line.starts_with("@fragment") {
            // Check this line or next line for function declaration
            if line.contains("fn ") {
                // Function on same line: @fragment fn name(...)
                if let Some(fn_start) = line.find("fn ") {
                    let after_fn = &line[fn_start + 3..].trim();
                    if let Some(name_end) = after_fn.find(|c: char| c == '(' || c.is_whitespace()) {
                        return after_fn[..name_end].trim().to_string();
                    }
                }
            } else if i + 1 < lines.len() {
                // Function on next line
                let next_line = lines[i + 1].trim();
                if next_line.starts_with("fn ") {
                    let after_fn = &next_line[3..].trim();
                    if let Some(name_end) = after_fn.find(|c: char| c == '(' || c.is_whitespace()) {
                        return after_fn[..name_end].trim().to_string();
                    }
                }
            }
        }
        i += 1;
    }
    
    // Default to fs_main if not found
    "fs_main".to_string()
}

/// Preprocesses user-submitted shader code to ensure compatibility with the plugin system.
/// 
/// Returns: (processed_shader_code, fragment_entry_point_name)
/// 
/// Strategy:
/// 1. Always prepend standard uniforms (let WGSL compiler catch conflicts)
/// 2. Replace `inputs` with `uniforms` for Shadertoy compatibility
/// 3. If fragment-only: inject standard vertex shader
/// 4. Detect fragment entry point name (supports fragmentMain, fs_main, etc.)
fn preprocess_shader(user_code: &str) -> (String, String) {
    let user_code = user_code.trim();
    if user_code.is_empty() {
        return (get_default_shader().to_string(), "fs_main".to_string());
    }
    
    // Check what the user provided
    let has_vertex = user_code.contains("@vertex");
    let has_fragment = user_code.contains("@fragment");
    
    // Replace `inputs` with `uniforms` for Shadertoy-style compatibility
    // This handles cases where users write `inputs.size.xy` instead of `uniforms.size.xy`
    let mut processed_code = user_code.replace("inputs.", "uniforms.");
    processed_code = processed_code.replace("var<uniform> inputs", "var<uniform> uniforms");
    
    // Check if user already declared our standard uniforms (check after inputs->uniforms replacement)
    // Look for the exact pattern: struct Uniforms with all required fields and the variable declaration
    let has_uniforms_struct = processed_code.contains("struct Uniforms");
    // Check for all required fields in the struct
    let has_all_fields = processed_code.contains("size:") &&
                         processed_code.contains("mouse:") &&
                         processed_code.contains("time:") &&
                         processed_code.contains("frame:");
    // Check for the uniform variable declaration with our binding
    let has_uniforms_var = (processed_code.contains("var<uniform> uniforms") ||
                            processed_code.contains("var<uniform> inputs")) &&
                           processed_code.contains("@group(0) @binding(0)");
    
    // Only consider it a match if we have the struct, all fields, AND the variable declaration
    let has_standard_uniforms = has_uniforms_struct && has_all_fields && has_uniforms_var;
    
    // Normalize vec4f to vec4<f32> for compatibility (vec4f is newer WGSL syntax)
    // This ensures consistency with our standard shader code
    processed_code = processed_code.replace("vec4f", "vec4<f32>");
    processed_code = processed_code.replace("vec3f", "vec3<f32>");
    processed_code = processed_code.replace("vec2f", "vec2<f32>");
    processed_code = processed_code.replace("vec4i", "vec4<i32>");
    processed_code = processed_code.replace("vec3i", "vec3<i32>");
    processed_code = processed_code.replace("vec2i", "vec2<i32>");
    processed_code = processed_code.replace("vec4u", "vec4<u32>");
    processed_code = processed_code.replace("vec3u", "vec3<u32>");
    processed_code = processed_code.replace("vec2u", "vec2<u32>");
    
    // Detect fragment entry point name from the processed code (after inputs->uniforms replacement)
    // This needs to happen before we prepend uniforms/vertex shader
    let fragment_entry = if has_fragment {
        let detected = detect_fragment_entry_point(&processed_code);
        // If detection failed, fall back to fs_main
        if detected.is_empty() || detected == "fs_main" {
            detected
        } else {
            detected
        }
    } else {
        "fs_main".to_string()
    };
    
    // Build the final shader
    let mut result = String::new();
    
    // Only prepend standard uniforms if user hasn't already declared them
    if !has_standard_uniforms {
        result.push_str(STANDARD_UNIFORMS);
        result.push_str("\n\n");
    } else {
        // Debug: log that we're skipping uniforms because they're already present
        // (commented out to avoid spam, but useful for debugging)
        // print("Skipping STANDARD_UNIFORMS - already present in user shader");
    }
    
    // Add vertex shader if user didn't provide one
    if !has_vertex {
        result.push_str(STANDARD_VERTEX_SHADER);
        result.push_str("\n\n");
    }
    
    // Add user's processed code
    result.push_str(&processed_code);
    
    (result, fragment_entry)
}

fn draw_triangle() {
    print("draw_triangle() started");
    let gpu = webgpu::get_gpu();
    print("Got GPU");
    let adapter = gpu.request_adapter(None).unwrap();
    print("Got adapter");
    let device = adapter.request_device(None).unwrap();
    print("Got device");

    let canvas = surface::Surface::new(surface::CreateDesc {
        height: None,
        width: None,
    });
    let graphics_context = graphics_context::Context::new();
    canvas.connect_graphics_context(&graphics_context);
    device.connect_graphics_context(&graphics_context);

    print("Subscribing to events...");
    let pointer_up_pollable = canvas.subscribe_pointer_up();
    let pointer_down_pollable = canvas.subscribe_pointer_down();
    let pointer_move_pollable = canvas.subscribe_pointer_move();
    let key_up_pollable = canvas.subscribe_key_up();
    let key_down_pollable = canvas.subscribe_key_down();
    let resize_pollable = canvas.subscribe_resize();
    let frame_pollable = canvas.subscribe_frame();
    print("Events subscribed");
    let pollables = vec![
        &pointer_up_pollable,
        &pointer_down_pollable,
        &pointer_move_pollable,
        &key_up_pollable,
        &key_down_pollable,
        &resize_pollable,
        &frame_pollable,
    ];
    
    // Cached resources - only recreate when shader code changes
    let mut cached_shader_code: Option<String> = None;
    let mut cached_fragment_entry_point: Option<String> = None;
    // Note: We cache these modules for potential future use (hot-reloading, etc.)
    // They're currently unused but kept for extensibility
    let mut _cached_vertex_module: Option<webgpu::GpuShaderModule> = None;
    let mut _cached_fragment_module: Option<webgpu::GpuShaderModule> = None;
    let mut cached_pipeline: Option<webgpu::GpuRenderPipeline> = None;
    let mut last_failed_shader: Option<String> = None;
    
    // Create uniform buffer for plugin system
    // Uniforms struct: size (vec4<f32>) + mouse (vec4<f32>) + time (f32) + frame (i32) = 40 bytes
    // Aligned to 16 bytes per WebGPU spec, so we need 48 bytes total
    print("Creating uniform buffer...");
    let uniform_buffer_size: u64 = 48;
    let uniform_buffer = device.create_buffer(&webgpu::GpuBufferDescriptor {
        label: Some("Uniforms".to_string()),
        size: uniform_buffer_size,
        usage: 0x0040 | 0x0008, // uniform | copy_dst
        mapped_at_creation: None,
    });
    print("Uniform buffer created");
    
    // Create bind group layout for uniforms
    print("Creating bind group layout...");
    let bind_group_layout = device.create_bind_group_layout(&webgpu::GpuBindGroupLayoutDescriptor {
        label: Some("Uniforms Bind Group Layout".to_string()),
        entries: vec![webgpu::GpuBindGroupLayoutEntry {
            binding: 0,
            visibility: 0x0001 | 0x0002, // vertex | fragment
            buffer: Some(webgpu::GpuBufferBindingLayout {
                type_: Some(webgpu::GpuBufferBindingType::Uniform),
                has_dynamic_offset: None,
                min_binding_size: Some(uniform_buffer_size),
            }),
            sampler: None,
            texture: None,
            storage_texture: None,
        }],
    });
    print("Bind group layout created");
    
    // Create bind group
    print("Creating bind group...");
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
    print("Bind group created");
    
    print("Creating pipeline layout...");
    let pipeline_layout = device.create_pipeline_layout(&webgpu::GpuPipelineLayoutDescriptor {
        label: None,
        bind_group_layouts: vec![Some(&bind_group_layout)],
    });
    print("Pipeline layout created");
    print("About to initialize time tracking variables...");
    
    // Track time and frame for animations
    // Note: SystemTime::now() crashes in WASI, so we use frame-based time instead
    // We'll calculate time as frame_count / 60.0 (assuming 60 FPS)
    print("Skipping SystemTime::now() - using frame-based time instead");
    print("Initializing size tuple...");
    let mut size = (800.0f32, 600.0f32, 800.0f32 / 600.0f32, 0.0f32); // width, height, aspect_ratio, unused
    print("Size tuple initialized");
    print("Initializing mouse_pos tuple...");
    let mut mouse_pos = (0.0f32, 0.0f32, 0.0f32, 0.0f32); // x, y, unused, unused
    print("Mouse_pos tuple initialized");
    print("Initializing frame_count...");
    let mut frame_count: i32 = 0;
    print("Frame_count initialized");
    
    // Initialize with default shader to ensure we have a valid pipeline
    print("Preparing to initialize default shader pipeline...");
    let default_shader = get_default_shader().to_string();
    print("Got default shader");
    let (initial_shader_code, initial_fragment_entry) = preprocess_shader(&default_shader);
    print(&format!("Preprocessed shader, entry point: '{}'", initial_fragment_entry));
    
    // Try to create initial pipeline - wrap in panic handler for safety
    print("Creating initial shader modules...");
    let init_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        print("Inside panic handler, creating vertex module...");
        let initial_vertex_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
            code: initial_shader_code.clone(),
            label: None,
            compilation_hints: None,
        });
        print("Vertex module created");
        print("Creating fragment module...");
        let initial_fragment_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
            code: initial_shader_code.clone(),
            label: None,
            compilation_hints: None,
        });
        print("Fragment module created");
        let initial_vertex = webgpu::GpuVertexState {
            module: &initial_vertex_module,
            entry_point: Some("vs_main".to_string()),
            buffers: None,
            constants: None,
        };
        let initial_fragment = webgpu::GpuFragmentState {
            module: &initial_fragment_module,
            entry_point: Some(initial_fragment_entry.clone()),
            targets: vec![Some(webgpu::GpuColorTargetState {
                format: webgpu::GpuTextureFormat::Bgra8unorm,
                blend: None,
                write_mask: None,
            })],
            constants: None,
        };
        let initial_pipeline_description = webgpu::GpuRenderPipelineDescriptor {
            label: None,
            vertex: initial_vertex,
            fragment: Some(initial_fragment),
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
        };
        print("Creating render pipeline...");
        let initial_pipeline = device.create_render_pipeline(initial_pipeline_description);
        print("Render pipeline created successfully!");
        (initial_vertex_module, initial_fragment_module, initial_pipeline, initial_shader_code, initial_fragment_entry)
    }));
    
    print("Initialization result received");
    
    // Initialize cache with default shader if successful
    print("Matching initialization result...");
    match init_result {
        Ok((ivm, ifm, ip, isc, ife)) => {
            print("Initialization succeeded, updating cache...");
            cached_shader_code = Some(isc);
            cached_fragment_entry_point = Some(ife);
            _cached_vertex_module = Some(ivm);
            _cached_fragment_module = Some(ifm);
            cached_pipeline = Some(ip);
            print("Initialized default shader pipeline successfully.");
        }
        Err(_) => {
            // Default shader failed - this is a critical error
            print("ERROR: Failed to initialize default shader pipeline. Will try user shader in loop.");
            // Continue anyway - the loop will try to compile user shaders
            // Mark that we need to process the user shader immediately
        }
    }
    
    print("Entering main render loop...");
    loop {
        // Check if shader code has changed
        let user_shader_code = {
            let state = SHADER_STATE.lock().unwrap();
            state.clone().unwrap_or_else(|| get_default_shader().to_string())
        };
        
        // Preprocess the shader to ensure uniform compatibility
        let (current_shader_code, fragment_entry_point) = preprocess_shader(&user_shader_code);
        
        // Only recreate shader modules and pipeline if shader code or entry point changed
        let shader_changed = cached_shader_code.as_ref().map(|s| s != &current_shader_code).unwrap_or(true) ||
                           cached_fragment_entry_point.as_ref().map(|e| e != &fragment_entry_point).unwrap_or(true);
        
        if shader_changed {
            print(&format!("Compiling shader with entry point: '{}'", fragment_entry_point));
            // Try to validate and compile the new shader
            let validation_result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
                // Create new shader modules
                let vertex_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
                    code: current_shader_code.clone(),
                    label: None,
                    compilation_hints: None,
                });
                let fragment_module = device.create_shader_module(&webgpu::GpuShaderModuleDescriptor {
                    code: current_shader_code.clone(),
                    label: None,
                    compilation_hints: None,
                });
                
                // Create new render pipeline
                let vertex = webgpu::GpuVertexState {
                    module: &vertex_module,
                    entry_point: Some("vs_main".to_string()),
                    buffers: None,
                    constants: None,
                };
                let fragment = webgpu::GpuFragmentState {
                    module: &fragment_module,
                    entry_point: Some(fragment_entry_point.clone()),
                    targets: vec![Some(webgpu::GpuColorTargetState {
                        format: webgpu::GpuTextureFormat::Bgra8unorm,
                        blend: None,
                        write_mask: None,
                    })],
                    constants: None,
                };
                let pipeline_description = webgpu::GpuRenderPipelineDescriptor {
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
                };
                let pipeline = device.create_render_pipeline(pipeline_description);
                (vertex_module, fragment_module, pipeline)
            }));
            
            match validation_result {
                Ok((vertex_module, fragment_module, pipeline)) => {
                    // Shader compiled successfully, update cached resources
                    _cached_vertex_module = Some(vertex_module);
                    _cached_fragment_module = Some(fragment_module);
                    cached_pipeline = Some(pipeline);
                    cached_shader_code = Some(current_shader_code.clone());
                    cached_fragment_entry_point = Some(fragment_entry_point.clone());
                    last_failed_shader = None; // Clear failed shader tracking on success
                    print(&format!("Shader compiled successfully with entry point: '{}'", fragment_entry_point));
                }
                Err(_panic_info) => {
                    // Shader compilation panicked (likely invalid shader code)
                    // Only warn if this is a different invalid shader than last time
                    if last_failed_shader.as_ref() != Some(&current_shader_code) {
                        print(&format!("Warning: Shader compilation failed. Entry point: '{}'. Keeping previous shader.", fragment_entry_point));
                        last_failed_shader = Some(current_shader_code);
                    }
                    // Skip rendering this frame if we don't have a valid pipeline
                    // But ensure we still have a valid pipeline from before
                    if cached_pipeline.is_none() {
                        print("ERROR: No valid pipeline available. Cannot render.");
                    }
                    continue;
                }
            }
        }
        
        // Ensure we have a valid pipeline before rendering
        let render_pipeline = match cached_pipeline.as_ref() {
            Some(p) => p,
            None => {
                // No valid pipeline yet, skip rendering
                // This can happen if initialization failed and user shader also failed
                continue;
            }
        };
        
        // Poll for events - this should yield control if no events are available
        // Wrap in panic handler to prevent crashes
        let pollables_res = match std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            ::wasi::io::poll::poll(&pollables)
        })) {
            Ok(res) => res,
            Err(_) => {
                print("ERROR: poll() panicked, exiting loop");
                break;
            }
        };

        if pollables_res.contains(&0) {
            let event = canvas.get_pointer_up();
            print(&format!("pointer_up: {:?}", event));
        }
        if pollables_res.contains(&1) {
            let event = canvas.get_pointer_down();
            print(&format!("pointer_down: {:?}", event));
        }
        if pollables_res.contains(&2) {
            let event = canvas.get_pointer_move();
            if let Some(e) = event {
                mouse_pos = (e.x as f32, e.y as f32, 0.0, 0.0);
            }
        }
        if pollables_res.contains(&3) {
            let event = canvas.get_key_up();
            print(&format!("key_up: {:?}", event));
        }
        if pollables_res.contains(&4) {
            let event = canvas.get_key_down();
            print(&format!("key_down: {:?}", event));
        }
        if pollables_res.contains(&5) {
            let event = canvas.get_resize();
            if let Some(e) = event {
                let width = e.width as f32;
                let height = e.height as f32;
                let aspect = width / height;
                size = (width, height, aspect, 0.0);
            }
        }

        if pollables_res.contains(&6) {
            canvas.get_frame();
            
            // Debug: Check if we're actually rendering
            if frame_count % 60 == 0 {
                print(&format!("Rendering frame {}, pipeline exists: {}", frame_count, cached_pipeline.is_some()));
            }

            // Update uniform buffer with current time, size, mouse position, and frame count
            // Use frame_count as time source (assuming 60 FPS)
            frame_count += 1;
            let time = frame_count as f32 / 60.0; // Convert frame count to seconds
            
            // Pack uniform data: size (vec4<f32>), mouse (vec4<f32>), time (f32), frame (i32)
            // WebGPU requires uniform buffers to be aligned to 16 bytes
            // Layout: size (offset 0, 16 bytes), mouse (offset 16, 16 bytes), time (offset 32, 4 bytes), frame (offset 36, 4 bytes), padding (offset 40-47)
            let mut uniform_data = vec![0u8; 48];
            
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

            {
                let render_pass_description = webgpu::GpuRenderPassDescriptor {
                    label: Some(String::from("fdsa")),
                    color_attachments: vec![Some(webgpu::GpuRenderPassColorAttachment {
                        view: &view,
                        depth_slice: None,
                        resolve_target: None,
                        clear_value: Some(webgpu::GpuColor {
                            r: 0.0,
                            g: 0.0,
                            b: 0.1,
                            a: 0.0,
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

                render_pass.set_pipeline(&render_pipeline);
                let _ = render_pass.set_bind_group(0, Some(&bind_group), None, None, None);
                render_pass.draw(3, None, None, None);
                render_pass.end();
            }

            device.queue().submit(&[&encoder.finish(None)]);
            graphics_context.present();
        }
    }
    
    print("Render loop exited (this shouldn't happen)");
}

fn print(s: &str) {
    let stdout = ::wasi::cli::stdout::get_stdout();
    stdout.blocking_write_and_flush(s.as_bytes()).unwrap();
    stdout.blocking_write_and_flush(b"\n").unwrap();
}
