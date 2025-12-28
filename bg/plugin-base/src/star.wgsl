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
    let normalize = vec4<f32>(beige * brightness, 1.0);
    return normalize;
}

fn skew(uv: vec2f) -> vec2f {
    let kx = 0.3; // horizontal skew
    let ky = 0.2; // vertical skew
    let skewed_uv = vec2f(uv.x + uv.y * kx, uv.y + uv.x * ky);
    return skewed_uv;
}

// emulates the resolution we need for the black-hole effect to have enough stars
const star_swirl_ref_resolution = vec2<f32>(3250.0, 1276.0);
const bg_ref_resolution = vec2<f32>(2200.0, 1276.0);

const starstream_yellow = vec4<f32>(237.0/255.0, 177.0/255.0, 0.0, 1.0);
const starstream_light_green = vec4<f32>(25.0 / 255.0, 177.0 / 255.0, 123.0 / 255.0, 1.0);
const starstream_dark_green = vec4(18.0/255, 39.0/255, 31.0/255, 1.0);
const dropshadow_factor = 0.2;

fn constant_foreground(pos: vec2f) -> vec4f {
    let resolution = star_swirl_ref_resolution;
    let aspect = resolution.x / resolution.y;

    let ref_resolution = bg_ref_resolution;
    let norm_uv = (pos.xy) / resolution.xy;
    let centered_uv = norm_uv * 2.0 - vec2<f32>(1.0, 1.0);
    var uv = centered_uv;

    let expand = vec2(
        resolution.x / ref_resolution.x,
        resolution.y / ref_resolution.y
    );
    let scaling_factor = vec2(
        expand.x * expand.y,
        expand.y * (expand.x * aspect)
    );
    uv.y /= scaling_factor.y;
    uv.x /= scaling_factor.x;

    // Circle setup
    let center = vec2<f32>(0.0, 0.0);
    let big_radius = vec2<f32>(
        (600.0 / resolution.x) / scaling_factor.x,
        (700.0 / resolution.y) / scaling_factor.y
    );
    let small_radius = vec2<f32>(
        (450.0 / resolution.x) / scaling_factor.x,
        (600.0 / resolution.y) / scaling_factor.y
    );
    let cutoff_radius = vec2<f32>(
        (435.0 / resolution.x) / scaling_factor.x,
        (585.0 / resolution.y) / scaling_factor.y
    );

    let skewed_uv = skew(uv);

    let big_mask = draw_circle(skewed_uv, center, big_radius, 0.03);
    let small_mask = draw_circle(skewed_uv, center, small_radius, 0.03);
    let cutoff_mask = draw_circle(skewed_uv, center, cutoff_radius, 0.03);
    let starstream_radius = vec2<f32>(
        (200.0 / resolution.x) / scaling_factor.x,
        (200.0 / resolution.y) / scaling_factor.y
    );
    let starstream_mask = draw_circle(uv, center, starstream_radius, 0.05);
    let ring_mask = big_mask - small_mask;

    let star = starstream_star(uv*40, starstream_yellow);
    let star_shadow = starstream_star(vec2(-0.05, -0.05) + uv*40, vec4(1));
    let asterisk = starstream_asterisk(vec2(-7,7) + uv*325, 6, 0.17, 2, starstream_light_green);
    let asterisk_shadow = starstream_asterisk(vec2(-7.5,6.5) + uv*325, 6, 0.17, 2, vec4(1));

    // apply distortion at the center of the image
    uv = mix(uv, distort((skew(uv))*expand*scaling_factor*vec2(6, 3), vec2(1.0, 1.0)), big_mask);
    
    var result = vec4(0.0);

    // add stars
    let star_factor = 1*expand.x * expand.x*expand.y; // add more/less stars depending on the window size
    let combined_fields = starfield(uv, 200 * star_factor, 1) + starfield(uv, 10 * star_factor, 10.0);
    result = combined_fields;

    // add ring
    let wave_bg = vec3(0.22, 0.29, 0.35);
    result = vec4(mix(result.rgb, wave_bg, ring_mask*0.20), result.w);

    // cutoff center
    result = mix(result, vec4(0.0), cutoff_mask);

    // truncate to just the center
    result = mix(vec4(0.0), result, big_mask);

    // add Starstream logo
    result = mix(result, starstream_dark_green, starstream_mask);

    result = mix(result, vec4(0), dropshadow_factor*star_shadow.x);
    result += star;
    result = mix(result, vec4(0), dropshadow_factor*asterisk_shadow.y);
    result += asterisk;

    return result;
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let resolution = inputs.size.xy;
    let aspect = resolution.x / resolution.y;

    let ref_resolution = bg_ref_resolution;
    let norm_uv = pos.xy / resolution.xy;
    let centered_uv = norm_uv * 2.0 - vec2<f32>(1.0, 1.0);
    var uv = centered_uv;

    let expand = vec2(
        resolution.x / ref_resolution.x,
        resolution.y / ref_resolution.y
    );
    let scaling_factor = vec2(
        expand.x * expand.y,
        expand.y * (expand.x * aspect)
    );
    uv.y /= scaling_factor.y;
    uv.x /= scaling_factor.x;

    // Circle setup
    let center = vec2<f32>(0.0, 0.0);
    let big_radius = vec2<f32>(
        (600.0 / resolution.x) / scaling_factor.x,
        (700.0 / resolution.y) / scaling_factor.y
    );
    let skewed_uv = skew(uv);
    let big_mask = draw_circle(skewed_uv, center, big_radius, 0.03);

    var result = vec4(0.0);

    // add stars
    let star_factor = 1*expand.x * expand.x*expand.y; // add more/less stars depending on the window size
    let combined_fields = starfield(uv, 200 * star_factor, 1) + starfield(uv, 10 * star_factor, 10.0);
    
    let foreground = constant_foreground(pos.xy - (resolution-star_swirl_ref_resolution)/vec2(2.0));
    result = mix(combined_fields, foreground, big_mask);

    return result;
}

fn distort(inUV: vec2<f32>, scale: vec2<f32>) -> vec2<f32> {
    // Convert uv to reference-space, undoing aspect stretching
    var uv = inUV;

    let slowedTime = inputs.time / 20.0;
    var ang: f32 = 0.0;

    // Perform repeatable distortion
    for (var i = 0; i < 3; i = i + 1) {
        ang = slowedTime + 2.0 * length(uv);

        // rotation and scaling distortion
        uv = vec2<f32>(
            uv.x * cos(ang) + uv.y * sin(ang),
            uv.y * cos(ang) - uv.x * sin(ang)
        );

        uv *= 2.0 - length(uv);
        uv.y += sin(8.0 * uv.x + 3.0 * slowedTime) / 4.0;
        uv.x *= (0.5 + 0.5 * sin(16.0 * uv.x + slowedTime * 4.0));
    }

    // Return to normalized coordinate space
    uv /= scale;
    let warpedUV = fract(uv / 100.0);
    return warpedUV;
}

fn starstream_star(uv: vec2f, base_color: vec4f) -> vec4f {
    let r = length(uv)/2;

    let intensityX = smoothstep(0.4, 0.0, abs(uv.x) * 6.0 * (1.0 + r * 6.0));
    let intensityY = smoothstep(0.4, 0.0, abs(uv.y) * 6.0 * (1.0 + r * 6.0));

    var glow = (intensityX + intensityY) * 5.0;

    let radial_mask = 1.0 - smoothstep(0.3, 0.9, r);
    glow *= radial_mask;

    // Anti-aliased edge
    let edge = fwidth(glow);
    let final_mask = smoothstep(0.0, 1 + edge, glow);

    let color = base_color.xyz * final_mask;
    return vec4<f32>(color, 1.0);
}
fn starstream_asterisk(uv: vec2f, beam_count: f32, beam_width: f32, radius_limit: f32, base_color: vec4f) -> vec4f {
    let half_count = beam_count / 2.0;
    let pi = 3.1415926535;
    let angle_step = pi / half_count;

    var beam_mask = 0.0;

    for (var i = 0u; i < u32(half_count); i = i + 1u) {
        let angle = (2*pi * 30 / 360) + f32(i) * angle_step;
        let c = cos(angle);
        let s = sin(angle);
        let rotated = vec2<f32>(
            uv.x * c + uv.y * s,
            uv.y * c - uv.x * s
        );

        // continuous distance to beam center (y=0 line)
        let dist_to_axis = abs(rotated.y);

        // Use derivative-based smoothing for anti-aliased lines
        let aa = fwidth(dist_to_axis)/2;
        let strip = 1.0 - smoothstep(beam_width - aa, beam_width + aa, dist_to_axis);

        beam_mask = max(beam_mask, strip);
    }

    // radial distance field (for cutoff)
    let r = length(uv);
    let aa_r = fwidth(r);
    let radial_mask = 1.0 - smoothstep(radius_limit - aa_r, radius_limit + aa_r, r);

    // combine beam mask and radial cutoff
    let final_mask = beam_mask * radial_mask;

    // color
    let asterisk_color = base_color.xyz;
    let color = asterisk_color * final_mask;

    return vec4<f32>(color, 1.0);
}

fn draw_circle(uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>, feather: f32) -> f32 {
    // Compute normalized ellipse distance
    let dx = (uv.x - center.x) / radius.x;
    let dy = (uv.y - center.y) / radius.y;
    let dist = sqrt(dx * dx + dy * dy);

    // 'dist' = 1.0 at the edge, <1 inside, >1 outside
    // Feather controls how soft the edge is
    let edge0 = 1.0 - feather; // inner start of fade
    let edge1 = 1.0 + feather; // outer end of fade

    // Smooth transition: 1 inside → 0 outside
    return 1.0 - smoothstep(edge0, edge1, dist);
}
