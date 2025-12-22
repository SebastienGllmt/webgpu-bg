## Compiling the Example

### Install Tooling

#### wasm-tools
```shell
cargo install wasm-tools
```

### Compile the Example

```shell
rustup target add wasm32-unknown-unknown
cargo build --target wasm32-unknown-unknown --release
wasm-tools component new ./target/wasm32-unknown-unknown/release/plugin_base.wasm -o ./bin/plugin-bg.wasm
```
