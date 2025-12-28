fn draw_circle(uv: vec2<f32>, center: vec2<f32>, radius: vec2<f32>) -> vec4<f32> {
    // Compute normalized distances along each axis
    let dx = uv.x - center.x;
    let dy = uv.y - center.y;

    // Ellipse equation
    let ellipse = (dx * dx) / (radius.x * radius.x) +
                  (dy * dy) / (radius.y * radius.y);

    // Inside the ellipse → black; outside → white
    if ellipse <= 1.0 {
        return vec4<f32>(0.0, 0.0, 0.0, 1.0);
    } else {
        return vec4<f32>(1.0, 1.0, 1.0, 1.0);
    }
}

@fragment
fn fragmentMain(@builtin(position) pos: vec4f) -> @location(0) vec4f {
    let resolution = inputs.size.xy;
    let aspect = inputs.size.x / inputs.size.y;
    let inv_aspect = inputs.size.y / inputs.size.x;

    let ref_resolution = vec2<f32>(2200, 1160);

    // Normalized coordinates in [-1, 1] space
    let norm_uv = pos.xy / resolution.xy;
    let centered_uv = norm_uv * 2.0 - vec2<f32>(1.0, 1.0);
    var uv = centered_uv;

    // handler user increasing/decreasing window size
    let x_expand = inputs.size.x / ref_resolution.x;
    let y_expand = inputs.size.y / ref_resolution.y;
    let scaling_factor_y = y_expand*(x_expand* aspect);
    let scaling_factor_x = x_expand*y_expand;
    uv.y /= scaling_factor_y;
    uv.x /= scaling_factor_x;

    // Define the circle’s center and radius
    let radius = vec2<f32>(0.5 / scaling_factor_x, 0.5 / scaling_factor_y);
    let center = vec2<f32>(0, 0);
    var circle = draw_circle(uv, center, radius);
    return circle;
}