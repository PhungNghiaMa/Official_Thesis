window.CRT_VERTEX_SHADER = `
varying vec2 vUv;
varying vec3 vPos;

void main() {
    vUv = uv;
    vPos = (modelMatrix * vec4(position, 1.0)).xyz;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;

window.CRT_FRAGMENT_SHADER = `
uniform sampler2D screenTex;
uniform vec3 cameraPos;
uniform float curvature;
uniform float scanlineIntensity;
uniform float subpixelDensity;

varying vec2 vUv;
varying vec3 vPos;

// CRT curvature: barrel distortion
vec2 curvedUV(vec2 uv) {
    uv = uv * 2.0 - 1.0; 
    uv += uv * (uv.yx * uv.yx) * curvature;
    uv = uv * 0.5 + 0.5;
    return uv;
}

// RGB subpixel mask
vec3 crtMask(vec2 uv) {
    float phase = mod(floor(uv.x * subpixelDensity), 3.0);
    if (phase == 0.0) return vec3(1.0, 0.2, 0.2);
    if (phase == 1.0) return vec3(0.2, 1.0, 0.2);
    return vec3(0.2, 0.2, 1.0);
}

// Scanlines
float scanline(vec2 uv) {
    return 0.75 + sin(uv.y * 1200.0) * scanlineIntensity;
}

// Bloom glow
vec3 bloom(vec3 col) {
    float b = max(max(col.r,col.g),col.b);
    return col + b * 0.15;
}

void main() {
    float dist = distance(cameraPos, vPos);
    float blur = clamp(dist * 0.03, 0.0, 1.0);

    vec2 uv = curvedUV(vUv);

    vec3 base = texture2D(screenTex, uv).rgb;
    vec3 mask = crtMask(uv);

    vec3 pixelColor = base * mask;
    pixelColor *= scanline(uv);
    pixelColor = bloom(pixelColor);

    vec3 smooth = vec3((base.r + base.g + base.b) / 3.0);

    vec3 finalColor = mix(pixelColor, smooth, blur);

    gl_FragColor = vec4(finalColor, 1.0);
}
`;
