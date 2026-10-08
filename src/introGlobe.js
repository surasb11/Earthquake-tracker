// NASA Blue Marble texture from the supplied design reference. The sphere is
// shaded on the GPU so its rotation does not compete with the loading map.
const VERTEX_SHADER = `
  attribute vec2 position;
  void main() { gl_Position = vec4(position, 0.0, 1.0); }
`;

const FRAGMENT_SHADER = `
  precision highp float;
  uniform sampler2D earth;
  uniform vec2 center;
  uniform float radius;
  uniform float longitude;
  uniform float latitude;
  const float PI = 3.14159265359;
  void main() {
    vec2 point = (gl_FragCoord.xy - center) / radius;
    float distance = length(point);
    // Keep pixels outside the actual sphere transparent, without a halo or rim.
    if (distance >= 1.0) { gl_FragColor = vec4(0.0); return; }
    float edge = 1.0 - smoothstep(1.0 - 1.5 / radius, 1.0, distance);
    vec3 normal = vec3(point, sqrt(max(0.0, 1.0 - dot(point, point))));
    float sinLatitude = sin(latitude);
    float cosLatitude = cos(latitude);
    float u = 0.5 + longitude / (2.0 * PI)
      + atan(normal.x, normal.z * cosLatitude - normal.y * sinLatitude) / (2.0 * PI);
    float v = 0.5 - asin(clamp(normal.y * cosLatitude + normal.z * sinLatitude, -1.0, 1.0)) / PI;
    vec3 color = texture2D(earth, vec2(fract(u), v)).rgb;
    color *= 0.36 + 0.79 * max(0.0, dot(normal, vec3(-0.38, 0.56, 0.74)));
    gl_FragColor = vec4(color, edge);
  }
`;

const radians = (degrees) => degrees * Math.PI / 180;
const smoothstep = (value) => value * value * (3 - 2 * value);

export function createIntroGlobe(canvas, markersCanvas, imageUrl, onFailure) {
  const gl = canvas.getContext('webgl', { alpha: true, antialias: false, depth: false, premultipliedAlpha: false });
  const markers = markersCanvas.getContext('2d');
  if (!gl || !markers) throw new Error('Intro rendering is unavailable.');

  const shaders = [];
  const program = gl.createProgram();
  const buffer = gl.createBuffer();
  const texture = gl.createTexture();
  let disposed = false;
  let ready = false;
  let width = 0;
  let height = 0;
  let ratio = 1;

  function destroy() {
    if (disposed) return;
    disposed = true;
    image.onload = null;
    image.onerror = null;
    canvas.removeEventListener('webglcontextlost', onContextLost);
    gl.deleteTexture(texture);
    gl.deleteBuffer(buffer);
    gl.deleteProgram(program);
    shaders.forEach((shader) => gl.deleteShader(shader));
    // React StrictMode may reuse the same canvas after effect cleanup. Release
    // our GPU resources without forcibly losing that reusable context.
  }

  const image = new Image();
  const onContextLost = (event) => {
    event.preventDefault();
    if (!disposed) onFailure();
  };

  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, VERTEX_SHADER], [gl.FRAGMENT_SHADER, FRAGMENT_SHADER]]) {
      const shader = gl.createShader(type);
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) throw new Error('Intro shader is unavailable.');
      gl.attachShader(program, shader);
    }
    gl.linkProgram(program);
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error('Intro renderer is unavailable.');
    gl.useProgram(program);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const position = gl.getAttribLocation(program, 'position');
    gl.enableVertexAttribArray(position);
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.uniform1i(gl.getUniformLocation(program, 'earth'), 0);
  } catch (error) {
    destroy();
    throw error;
  }

  const uniforms = Object.fromEntries(['center', 'radius', 'longitude', 'latitude'].map((name) => [name, gl.getUniformLocation(program, name)]));
  canvas.addEventListener('webglcontextlost', onContextLost);
  image.onload = () => {
    if (disposed) return;
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, image);
    ready = true;
  };
  image.onerror = () => { if (!disposed) onFailure(); };
  image.src = imageUrl;

  return {
    resize(nextWidth, nextHeight) {
      width = nextWidth;
      height = nextHeight;
      ratio = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = markersCanvas.width = Math.round(width * ratio);
      canvas.height = markersCanvas.height = Math.round(height * ratio);
      gl.viewport(0, 0, canvas.width, canvas.height);
      markers.setTransform(ratio, 0, 0, ratio, 0, 0);
    },
    draw(progress, earthquakes) {
      if (disposed || !ready || !width || !height) return;
      const opening = smoothstep(Math.min(1, progress / 0.25));
      const closing = smoothstep(Math.max(0, (progress - 0.81) / 0.19));
      const compact = width < 480 && height < 650;
      const landscape = height < 490 && width > 500;
      const baseRadius = Math.min(width * 0.34, height * (landscape ? 0.23 : compact ? 0.19 : 0.27), 280);
      const radius = baseRadius * (0.88 + 0.12 * opening + 0.04 * closing);
      const x = width / 2;
      const y = height * (landscape ? 0.33 : compact ? 0.32 : 0.385);
      // Enforce the sphere boundary in the browser compositor as well as the
      // shader, so no canvas pixels can form a ring outside the globe.
      canvas.style.clipPath = `circle(${radius}px at ${x}px ${y}px)`;
      // Time-based spherical rotation eases to the real tracker's starting view.
      const longitude = radians(-125 + 44.9 * smoothstep(progress));
      const latitude = radians(20 + 5.8 * smoothstep(progress));
      gl.uniform2f(uniforms.center, x * ratio, (height - y) * ratio);
      gl.uniform1f(uniforms.radius, radius * ratio);
      gl.uniform1f(uniforms.longitude, longitude);
      gl.uniform1f(uniforms.latitude, latitude);
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);

      markers.clearRect(0, 0, width, height);
      const sinLatitude = Math.sin(latitude);
      const cosLatitude = Math.cos(latitude);
      for (const quake of earthquakes) {
        const coords = quake.geometry?.coordinates;
        if (!coords || !Number.isFinite(coords[0]) || !Number.isFinite(coords[1])) continue;
        const phi = radians(coords[1]);
        const delta = radians(coords[0]) - longitude;
        const c = Math.cos(phi);
        const s = Math.sin(phi);
        const front = s * sinLatitude + c * Math.cos(delta) * cosLatitude;
        if (front < 0.12) continue;
        const magnitude = quake.properties.mag;
        const color = magnitude >= 6 ? '#c0392b' : magnitude >= 5 ? '#e67e22' : magnitude >= 4 ? '#f39c12' : '#f4d03f';
        const markerRadius = Math.max(4, Math.min(15, magnitude * 1.8)) * Math.min(1, radius / 220);
        markers.shadowColor = color;
        markers.shadowBlur = 11;
        markers.strokeStyle = color;
        markers.fillStyle = color + '44';
        markers.lineWidth = 1.8;
        markers.beginPath();
        markers.arc(x + radius * c * Math.sin(delta), y - radius * (s * cosLatitude - c * Math.cos(delta) * sinLatitude), markerRadius, 0, Math.PI * 2);
        markers.fill();
        markers.stroke();
      }
    },
    destroy,
  };
}
