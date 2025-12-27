# Plugin Base

The goal of this project is to enable the creation of backgrounds for the Starstream OS that are powered by WebGPU and can run in the browser via [wasi-gfx](https://github.com/WebAssembly/wasi-gfx) v0.0.1

Designers can build visually rich, looping WebGPU shaders that safely run inside Starstream OS as a background for users to download/run without the risks of untrusted code.

The core architecture is this "plugin base" that sets up a common base for users to be able to plug in their own wgsl shaders (with some built-in). This plugin system is powered by compiling this project as a Wasm Component that exposes a way to update the shader as part of the WIT - effectively acting as a sandbox.

```
Browser ---provides user shader---> Wasm Component (this project) <-> WebGPU Context
```

This project has a few goals:
- Support the same format used by the [WebGPU Shader Toy](https://pongasoft.com/webgpu-shader-toy) to allow for good compatibility (ex: same Uniforms)
- Allow for backgrounds that are static, as well as those that have animations (either endless animations, or ones with a lead-up before entering the loop)
- Create backgrounds that cover the whole webpage (i.e. can scale and be reactive regardless of the user's browser size)
- Allow updating the shader code used (like a plugin system) without having to recompile the WASM program
- Consume minimal resources (as it's just a background). Note that the wind-up to an animation may be more GPU intensive as it happens before any other action in the OS
- sandbox through a Wasm Component allowing support for untrusted shader execution

## Standard

The user-provided shader has access to the following uniform

```
struct Uniforms {
    size:  vec4<f32>,
    mouse: vec4<f32>,
    time:  f32, // in fractional seconds
    frame: i32,
}
```

Additionally, the signature of the entry point of your fragment shader must look like this

```wgsl
@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    return vec4f(pos.xy / inputs.size.xy, 0.5, 1);
}
```

### Limitations

We currently have the following limitations:
- no custom root vertex shaders - the only one available is one that spans the whole of the user's virtual desktop
- no custom colors schemes - only `Bgra8unorm` is used
- no extending the uniform with custom properties
- no support for audio
- no support for interactivity


## Interacting with the plugin

Once compilers, the Wasm Component exposes two functions:
- `run` to start the program (following [wasi-cli](https://github.com/WebAssembly/wasi-cli)). This starts the render loop, and the function never terminates. The initial shader is just a solid grey color.
- `update-shader` to either set the initial shader to use, or update it to a new shader. It accepts wgsl code directly for your fragment shader. It can be called at any time. This function will return right away after setting the new shader and will not block waiting for it to be rendered on the screen. If an invalid shader is submitted, a black screen will be rendered.


```wit
export run: func();
export update-shader: func(shader-code: string);
```

## Guideline

Shaders which require no animations are recommended for performance reasons. For animations, the first 5 seconds will be unthrottled (to allow for GPU-intensive wind-up animations) before being throttled to avoid taxing the user's system (to allow for more important applications to run, but also to avoid draining the user's battery on mobile devices). If you animation does not have a "wind-up" state, be careful how you design your animation to take into the fact the animation speed will be throttled after 5s to avoid a jarring change in your animation's pace.

Note that, although no option is provided for users to tweak settings like animations speed, your animation's performance may depend on the user's device.

## Debugging

Currently there is no debugging support. Instead of using this tool for prototyping, we recommend testing your shader in another tool more optimized for debugging (ex: [WebGPU Shader Toy](https://pongasoft.com/webgpu-shader-toy)).

#### Setup

```shell
cargo install wasm-tools
rustup target add wasm32-unknown-unknown
cargo install wit-deps-cli
```

### Compile

```shell
wit-deps
cargo build --target wasm32-unknown-unknown --release
wasm-tools component new ./target/wasm32-unknown-unknown/release/plugin_base.wasm -o ./bin/plugin-bg.wasm
```
