const canvas = document.querySelector('.ribbon-background');
const gl = canvas.getContext('webgl', { alpha: false, antialias: false, depth: false });
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');

const vertexSource = `
  attribute vec2 position;
  void main() {
    gl_Position = vec4(position, 0., 1.);
  }
`;

const fragmentSource = `
  precision highp float;
  uniform vec2 resolution;
  uniform float time;

  void main() {
    vec2 uv = gl_FragCoord.xy / resolution;
    float y = 1. - uv.y;
    float drift = time * .32;

    // Twelve narrow ribbons with finite edges. The leading curve leaves white space.
    float bend = y * (1.05 + 3.10 * y);
    float phase = 4.25 * uv.x - .54 - bend;
    phase += .12 * sin(11. * y + 2. * uv.x) + .07 * sin(drift);
    if (phase <= 0. || phase >= 4.) {
      gl_FragColor = vec4(0., 0., 0., 1.);
      return;
    }

    float stripePhase = phase * 3.;
    float stripe = floor(stripePhase);
    float bandPosition = stripe / 3.;
    float face = fract(stripePhase);
    float shape = sin(6.28318 * (face - .13));
    float travel = y * 10. - drift + stripe * 1.83;
    float reflected = .5 + .5 * sin(travel + shape * (.89 + bandPosition * .13));
    float reflectedEdge = .24 + .11 * sin(travel + stripe);
    float gloss = 1. - smoothstep(.06, .31, abs(face - reflectedEdge));
    float underfold = smoothstep(.49, .87, face) * (1. - smoothstep(.88, 1., face));
    float lip = smoothstep(.87, .98, face);

    vec3 blue = mix(vec3(.42, .77, .98), vec3(.28, .58, .91), reflected);
    vec3 tint = mix(blue, vec3(.53, .43, .88), reflected * reflected * (.27 + .095 * bandPosition));
    float pigment = (.29 + .30 * reflected + .18 * underfold) * (1. - .52 * gloss - .38 * lip);

    // Fade each curved edge and progressively bleach the lower ribbon into white.
    float edge = smoothstep(0., .23, phase) * (1. - smoothstep(3.79, 4., phase));
    float fade = 1. - smoothstep(.39 + .05 * bandPosition, .92 + .025 * bandPosition, y);
    vec3 color = tint * pigment * edge * fade * .65;
    gl_FragColor = vec4(color, 1.);
  }
`;

function compile(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    throw new Error(gl.getShaderInfoLog(shader));
  }
  return shader;
}

function startBackground() {
  const program = gl.createProgram();
  gl.attachShader(program, compile(gl.VERTEX_SHADER, vertexSource));
  gl.attachShader(program, compile(gl.FRAGMENT_SHADER, fragmentSource));
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    throw new Error(gl.getProgramInfoLog(program));
  }
  gl.useProgram(program);

  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);
  const position = gl.getAttribLocation(program, 'position');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

  const resolution = gl.getUniformLocation(program, 'resolution');
  const time = gl.getUniformLocation(program, 'time');
  let frameId;
  let previousFrame = 0;
  let elapsed = 0;
  let inView = false;

  function draw() {
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    const scale = Math.min(1, 800 / Math.max(width, height));
    canvas.width = Math.max(1, Math.round(width * scale));
    canvas.height = Math.max(1, Math.round(height * scale));
    gl.viewport(0, 0, canvas.width, canvas.height);
    gl.uniform2f(resolution, canvas.width, canvas.height);
    paint();
  }

  function paint() {
    gl.uniform1f(time, elapsed);
    gl.drawArrays(gl.TRIANGLES, 0, 3);
  }

  function animate(now) {
    frameId = requestAnimationFrame(animate);
    if (now - previousFrame < 1000 / 24) return;
    elapsed += Math.min((now - previousFrame) / 1000, .075);
    previousFrame = now;
    paint();
  }

  function syncMotion() {
    cancelAnimationFrame(frameId);
    if (!inView || reducedMotion.matches || document.hidden || gl.isContextLost()) return;
    previousFrame = performance.now();
    frameId = requestAnimationFrame(animate);
  }

  draw();
  new IntersectionObserver(([entry]) => {
    inView = entry.isIntersecting;
    syncMotion();
  }).observe(canvas);
  new ResizeObserver(draw).observe(canvas);
  reducedMotion.addEventListener('change', syncMotion);
  document.addEventListener('visibilitychange', syncMotion);
  canvas.addEventListener('webglcontextlost', () => {
    cancelAnimationFrame(frameId);
    canvas.hidden = true;
  }, { once: true });
}

if (gl) {
  try {
    startBackground();
  } catch (error) {
    canvas.hidden = true;
    console.warn('Ribbon background could not start.', error);
  }
}
