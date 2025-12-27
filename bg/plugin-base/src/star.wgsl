fn hash(p: vec2<f32>) -> f32 {
    // Returns a pseudo-random value in [0,1)
    var h = dot(p, vec2<f32>(127.1, 311.7));
    return fract(sin(h) * 43758.5453123);
}

fn hash2(p: vec2<f32>) -> vec2<f32> {
    var h = vec2<f32>(
        dot(p, vec2<f32>(127.1, 311.7)),
        dot(p, vec2<f32>(269.5, 183.3))
    );
    return fract(sin(h) * 43758.5453123);
}

// -----------------------------------------------------------------------------
// Voronoi computation that returns both the minimum distance and the seed hash
// -----------------------------------------------------------------------------

fn voronoi(p: vec2<f32>) -> vec2<f32> {
    let n = floor(p);
    let f = fract(p);
    var minDist = 8.0;
    var seedVal = 0.0;

    for (var j = -1; j <= 1; j = j + 1) {
        for (var i = -1; i <= 1; i = i + 1) {
            let g = vec2<f32>(f32(i), f32(j));
            let o = hash2(n + g);
            let r = g + o - f;
            let d = length(r);
            if (d < minDist) {
                minDist = d;
                // Use the hash of this cell to give the star its own brightness
                seedVal = hash(n + g);
            }
        }
    }
    // Return both (distance, unique seed value)
    return vec2<f32>(0.5*minDist, seedVal);
}

// -----------------------------------------------------------------------------
// Fragment main
// -----------------------------------------------------------------------------

fn starfield(uv: vec2f, numStars: f32, brightnessFactor: f32) -> vec4<f32> {
    // Scale controls star density
    var p = uv * numStars;

    // Compute Voronoi data: nearest distance + per-cell random value
    let v = voronoi(p);
    let d = v.x;
    let seedVal = v.y;

    var brightness = smoothstep(0.05, 0.0, d);

    // Apply a static random brightness per star
    let perStarBrightness = mix(0.4, 1.0, seedVal);
    brightness *= perStarBrightness;

    // Sharpen and contrast stars
    brightness = pow(brightness, brightnessFactor);

    let beige = vec3<f32>(0.93, 0.91, 0.35);
    return vec4<f32>(beige, brightness);
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let resolution = inputs.size.xy;
    let aspect = inputs.size.x / inputs.size.y;
    let inv_aspect = inputs.size.y / inputs.size.x;

    let ref_resolution = vec2<f32>(2200, 1160);

    // Normalized coordinates in [-1, 1] space
    var uv = pos.xy / resolution.xy;

    uv = uv * 2.0 - vec2<f32>(1.0, 1.0);

    // handler user increasing/decreasing window size
    let x_expand = inputs.size.x / ref_resolution.x;
    let y_expand = inputs.size.y / ref_resolution.y;
    uv.y /= y_expand*(x_expand* aspect);
    uv.x /= x_expand*y_expand;
    // need to add more/less stars depending on the window size as well
    let star_factor = x_expand * x_expand*y_expand;

    let combined_fields = starfield(uv, 200 * star_factor, 1) + starfield(uv, 10 * star_factor, 10.0);

    return vec4<f32>(combined_fields);
}