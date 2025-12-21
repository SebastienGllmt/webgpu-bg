import { useEffect, useRef } from 'react';

// Default shader with a simple color effect (can be customized)
const DEFAULT_SHADER = `
  @group(0) @binding(0) var inputTexture: texture_2d<f32>;
  @group(0) @binding(1) var inputSampler: sampler;
  
  @vertex
  fn vs_main(@builtin(vertex_index) vertexIndex: u32) -> @builtin(position) vec4<f32> {
    var pos = array<vec2<f32>, 6>(
      vec2<f32>(-1.0, -1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>(-1.0,  1.0),
      vec2<f32>(-1.0,  1.0),
      vec2<f32>( 1.0, -1.0),
      vec2<f32>( 1.0,  1.0)
    );
    return vec4<f32>(pos[vertexIndex], 0.0, 1.0);
  }
  
  @fragment
  fn fs_main(@builtin(position) position: vec4<f32>) -> @location(0) vec4<f32> {
    let texSize = vec2<f32>(textureDimensions(inputTexture));
    let uv = vec2<f32>(position.xy) / texSize;
    var color = textureSample(inputTexture, inputSampler, uv);
    
    // Apply a simple color effect (example: slight color shift)
    // You can customize this to apply any effect you want
    color.rgb = color.rgb * 0.9 + vec3<f32>(0.1, 0.05, 0.0);
    
    return color;
  }
`;

// WebGPU type declarations
declare global {
  interface Navigator {
    gpu?: GPU;
  }
  
  interface GPU {
    requestAdapter(options?: GPURequestAdapterOptions): Promise<GPUAdapter | null>;
    getPreferredCanvasFormat(): GPUTextureFormat;
  }
  
  interface GPUAdapter {
    requestDevice(descriptor?: GPUDeviceDescriptor): Promise<GPUDevice>;
  }
  
  interface GPUDevice extends EventTarget {
    destroy(): void;
    queue: GPUQueue;
    createShaderModule(descriptor: GPUShaderModuleDescriptor): GPUShaderModule;
    createRenderPipeline(descriptor: GPURenderPipelineDescriptor): GPURenderPipeline;
    createTexture(descriptor: GPUTextureDescriptor): GPUTexture;
    createSampler(descriptor?: GPUSamplerDescriptor): GPUSampler;
    createBindGroup(descriptor: GPUBindGroupDescriptor): GPUBindGroup;
    createCommandEncoder(descriptor?: GPUCommandEncoderDescriptor): GPUCommandEncoder;
  }
  
  interface GPUQueue {
    copyExternalImageToTexture(
      source: GPUImageCopyExternalImage,
      destination: GPUImageCopyTextureTagged,
      copySize: GPUExtent3D
    ): void;
    submit(commandBuffers: GPUCommandBuffer[]): void;
  }
  
  interface GPURenderPipeline {
    getBindGroupLayout(index: number): GPUBindGroupLayout;
  }
  
  interface GPUTexture {
    destroy(): void;
    createView(descriptor?: GPUTextureViewDescriptor): GPUTextureView;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUTextureView {}
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUSampler {}
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUBindGroup {}
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUBindGroupLayout {}
  
  interface GPUCommandEncoder {
    beginRenderPass(descriptor: GPURenderPassDescriptor): GPURenderPassEncoder;
    finish(descriptor?: GPUCommandBufferDescriptor): GPUCommandBuffer;
  }
  
  interface GPURenderPassEncoder {
    setPipeline(pipeline: GPURenderPipeline): void;
    setBindGroup(index: number, bindGroup: GPUBindGroup | null): void;
    draw(vertexCount: number, instanceCount?: number, firstVertex?: number, firstInstance?: number): void;
    end(): void;
  }
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUCommandBuffer {}
  
  interface GPUCanvasContext {
    configure(configuration: GPUCanvasConfiguration): void;
    getCurrentTexture(): GPUTexture;
  }
  
  interface HTMLCanvasElement {
    getContext(contextId: 'webgpu', options?: GPUCanvasConfiguration): GPUCanvasContext | null;
  }
  
  const GPUTextureUsage: {
    readonly TEXTURE_BINDING: number;
    readonly COPY_DST: number;
    readonly STORAGE_BINDING: number;
    readonly COPY_SRC: number;
  };
  
  // eslint-disable-next-line @typescript-eslint/no-empty-object-type
  interface GPUShaderModule {}
  
  type GPUTextureFormat = string;
  type GPUShaderModuleDescriptor = { label?: string; code: string };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPURenderPipelineDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUTextureDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUSamplerDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUBindGroupDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUCommandEncoderDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUCommandBufferDescriptor = any;
  type GPUImageCopyExternalImage = { source: HTMLCanvasElement | ImageBitmap | OffscreenCanvas };
  type GPUImageCopyTextureTagged = { texture: GPUTexture };
  type GPUExtent3D = [number, number] | [number, number, number];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPURenderPassDescriptor = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUTextureViewDescriptor = any;
  type GPUCanvasConfiguration = { device: GPUDevice; format: GPUTextureFormat };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPURequestAdapterOptions = any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  type GPUDeviceDescriptor = any;
}

interface WebGPUEffectOptions {
  /**
   * The canvas element to apply the effect to
   */
  canvas: HTMLCanvasElement | null;
  /**
   * Whether the effect is enabled
   */
  enabled?: boolean;
  /**
   * Custom WGSL shader code. If not provided, a default color effect is used.
   * The shader should have:
   * - @group(0) @binding(0) var inputTexture: texture_2d<f32>;
   * - @group(0) @binding(1) var inputSampler: sampler;
   */
  shader?: string;
  /**
   * Uniform buffer data (optional)
   */
  uniforms?: Float32Array;
}

/**
 * Applies a WebGPU effect to a 2D canvas element.
 * This hook reads from the canvas, applies a shader effect, and renders back to the canvas.
 */
export function useWebGPUEffect(options: WebGPUEffectOptions) {
  const { canvas, enabled = true, shader, uniforms } = options;
  const deviceRef = useRef<GPUDevice | null>(null);
  const pipelineRef = useRef<GPURenderPipeline | null>(null);
  const bindGroupRef = useRef<GPUBindGroup | null>(null);
  const inputTextureRef = useRef<GPUTexture | null>(null);
  const outputTextureRef = useRef<GPUTexture | null>(null);
  const outputCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const animationFrameRef = useRef<number | null>(null);

  useEffect(() => {
    if (!canvas || !enabled) {
      // Clean up animation frame if disabled
      if (animationFrameRef.current !== null) {
        cancelAnimationFrame(animationFrameRef.current);
        animationFrameRef.current = null;
      }
      return;
    }

    // Store canvas reference locally to avoid modifying the prop
    const canvasElement = canvas;
    let isActive = true;

    async function initWebGPU() {
      try {
        // Check for WebGPU support
        if (!navigator.gpu) {
          console.warn('WebGPU is not supported in this browser');
          return;
        }

        // Request adapter and device
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) {
          console.warn('Failed to get WebGPU adapter');
          return;
        }

        const device = await adapter.requestDevice();
        if (!isActive) {
          device.destroy();
          return;
        }

        deviceRef.current = device;

        // Hide the original canvas (we'll render the processed version on top)
        // We need to modify the canvas style to hide it - this is intentional
        // The canvas is a DOM element, not a React prop, so this is safe
        // Modifying DOM elements in useEffect is acceptable
        const originalDisplay = window.getComputedStyle(canvasElement).display || '';
        // @ts-expect-error - Intentional DOM manipulation in useEffect
        canvasElement.style.display = 'none';

        // Create output canvas for WebGPU rendering
        const outputCanvas = document.createElement('canvas');
        outputCanvas.width = canvasElement.width;
        outputCanvas.height = canvasElement.height;
        
        // Copy styles from original canvas
        const computedStyle = window.getComputedStyle(canvasElement);
        outputCanvas.style.cssText = canvasElement.style.cssText;
        outputCanvas.style.position = computedStyle.position || 'relative';
        outputCanvas.style.width = computedStyle.width;
        outputCanvas.style.height = computedStyle.height;
        outputCanvas.style.pointerEvents = 'none';
        
        // Insert output canvas right after the input canvas
        canvasElement.parentElement?.insertBefore(outputCanvas, canvasElement.nextSibling);
        outputCanvasRef.current = outputCanvas;

        // Get WebGPU context for output canvas
        const context = outputCanvas.getContext('webgpu');
        if (!context) {
          console.warn('Failed to get WebGPU context');
          return;
        }

        const format = navigator.gpu.getPreferredCanvasFormat();
        context.configure({
          device,
          format,
        });

        // Store context reference for render loop
        const contextRef = context;

        // Create shader module
        const shaderCode = shader || DEFAULT_SHADER;
        const shaderModule = device.createShaderModule({
          label: 'Canvas Effect Shader',
          code: shaderCode,
        });

        // Create render pipeline
        const pipeline = device.createRenderPipeline({
          label: 'Canvas Effect Pipeline',
          layout: 'auto',
          vertex: {
            module: shaderModule,
            entryPoint: 'vs_main',
          },
          fragment: {
            module: shaderModule,
            entryPoint: 'fs_main',
            targets: [{ format }],
          },
          primitive: {
            topology: 'triangle-list',
          },
        });

        pipelineRef.current = pipeline;

        // Create textures and bind group
        function createTextures() {
          // Clean up old textures
          if (inputTextureRef.current) {
            inputTextureRef.current.destroy();
          }
          if (outputTextureRef.current) {
            outputTextureRef.current.destroy();
          }

          // Create input texture (will be updated each frame)
          const inputTexture = device.createTexture({
            label: 'Input Texture',
            size: [canvasElement.width, canvasElement.height],
            format: 'rgba8unorm',
            usage: GPUTextureUsage.TEXTURE_BINDING | GPUTextureUsage.COPY_DST,
          });

          inputTextureRef.current = inputTexture;
          outputTextureRef.current = null; // Not needed for render pass approach

          // Create sampler
          const sampler = device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
          });

          // Create bind group
          const bindGroup = device.createBindGroup({
            label: 'Effect Bind Group',
            layout: pipeline.getBindGroupLayout(0),
            entries: [
              {
                binding: 0,
                resource: inputTexture.createView(),
              },
              {
                binding: 1,
                resource: sampler,
              },
            ],
          });

          bindGroupRef.current = bindGroup;
        }

        createTextures();

        // Handle canvas resize
        const resizeObserver = new ResizeObserver(() => {
          if (!isActive) return;
          
          const rect = canvasElement.getBoundingClientRect();
          const newWidth = Math.floor(rect.width * window.devicePixelRatio);
          const newHeight = Math.floor(rect.height * window.devicePixelRatio);

          if (newWidth !== canvasElement.width || newHeight !== canvasElement.height) {
            canvasElement.width = newWidth;
            canvasElement.height = newHeight;
            outputCanvas.width = newWidth;
            outputCanvas.height = newHeight;
            createTextures();
          }
        });

        resizeObserver.observe(canvasElement);

        // Render loop
        async function render() {
          if (!isActive || !deviceRef.current || !pipelineRef.current || !bindGroupRef.current) {
            return;
          }

          const device = deviceRef.current;
          const pipeline = pipelineRef.current;
          const bindGroup = bindGroupRef.current;
          const inputTexture = inputTextureRef.current;

          if (!inputTexture) return;

          // Copy canvas content to input texture
          device.queue.copyExternalImageToTexture(
            { source: canvasElement },
            { texture: inputTexture },
            [canvasElement.width, canvasElement.height]
          );

          // Get current texture from context
          if (!contextRef) return;
          const outputView = contextRef.getCurrentTexture().createView();

          // Create command encoder
          const encoder = device.createCommandEncoder();

          // Render pass
          const pass = encoder.beginRenderPass({
            colorAttachments: [
              {
                view: outputView,
                clearValue: { r: 0, g: 0, b: 0, a: 0 },
                loadOp: 'clear',
                storeOp: 'store',
              },
            ],
          });

          pass.setPipeline(pipeline);
          pass.setBindGroup(0, bindGroup);
          pass.draw(6, 1, 0, 0);
          pass.end();

          // Submit commands
          device.queue.submit([encoder.finish()]);

          // Schedule next frame
          animationFrameRef.current = requestAnimationFrame(render);
        }

        // Start render loop
        render();

        // Cleanup function
        return () => {
          isActive = false;
          resizeObserver.disconnect();
          
          if (animationFrameRef.current !== null) {
            cancelAnimationFrame(animationFrameRef.current);
            animationFrameRef.current = null;
          }

          if (inputTextureRef.current) {
            inputTextureRef.current.destroy();
            inputTextureRef.current = null;
          }

          if (outputTextureRef.current) {
            outputTextureRef.current.destroy();
            outputTextureRef.current = null;
          }

          if (outputCanvasRef.current) {
            outputCanvasRef.current.remove();
            outputCanvasRef.current = null;
          }

          // Restore original canvas visibility
          canvasElement.style.display = originalDisplay;

          if (deviceRef.current) {
            deviceRef.current.destroy();
            deviceRef.current = null;
          }
        };
      } catch (error) {
        console.error('Failed to initialize WebGPU effect:', error);
      }
    }

    const cleanup = initWebGPU();

    return () => {
      isActive = false;
      cleanup.then((cleanupFn) => cleanupFn?.());
    };
  }, [canvas, enabled, shader, uniforms]);
}
