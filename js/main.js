"use strict";

// var system = new particleSystem({ canvas_id: "ar-particle-area" });
// system.start();

const canvas = document.getElementsByTagName("canvas")[0];

function handleCanvasMouseEvent(e) {
  if (e.clientX <= canvas.offsetWidth && e.clientY <= canvas.offsetHeight) {
    e.stopPropagation();
    var newEvent = new MouseEvent("mousemove", {
      canBubbleArg: true,
      cancelableArg: true,
      viewArg: Window,
      detailArg: 0,
      screenX: e.screenX,
      screenY: e.screenY,
      clientX: e.clientX,
      clientY: e.clientY,
      ctrlKeyArg: false,
      altKeyArg: false,
      shiftKeyArg: false,
      metaKeyArg: false,
      buttonArg: 0,
      relatedTargetArg: null,
    });
    canvas.dispatchEvent(newEvent);
  }
}

const mouseEvents = document.getElementsByClassName("handle-mouse-event");

console.log(mouseEvents);
for (let i = 0; i < mouseEvents.length; i++) {
  mouseEvents[i].addEventListener("mousemove", (e) => {
    handleCanvasMouseEvent(e);
  });
}

canvas.width = canvas.clientWidth;
canvas.height = canvas.clientHeight;

let config = {
  TEXTURE_DOWNSAMPLE: 1,
  DENSITY_DISSIPATION: 0.89,
  VELOCITY_DISSIPATION: 0.99,
  //PRESSURE: 99,
  PRESSURE_DISSIPATION: 0,
  PRESSURE_ITERATIONS: 25,
  CURL: 2,
  SPLAT_RADIUS: 0.00015,
  SPLAT_FORCE: 90,
  SHADING: true,
  //COLORFUL: true,
  //COLOR_UPDATE_SPEED: 10,
  //PAUSED: false,
  //BACK_COLOR: { r: 0, g: 0, b: 0 },
  TRANSPARENT: true,
  BLOOM: true,
  BLOOM_ITERATIONS: 8,
  BLOOM_RESOLUTION: 1024,
  BLOOM_INTENSITY: 0.8,
  BLOOM_THRESHOLD: 0.6,
  BLOOM_SOFT_KNEE: 0.7,
  SUNRAYS: false,
  SUNRAYS_RESOLUTION: 196,
  SUNRAYS_WEIGHT: 0.1,
};

let pointers = [];
let splatStack = [];

const { gl, ext } = getWebGLContext(canvas);

function getWebGLContext(canvas) {
  const params = { alpha: true, depth: false, stencil: false, antialias: true };

  let gl = canvas.getContext("webgl2", params);
  const isWebGL2 = !!gl;
  if (!isWebGL2)
    gl =
      canvas.getContext("webgl", params) ||
      canvas.getContext("experimental-webgl", params);

  let halfFloat;
  let supportLinearFiltering;
  if (isWebGL2) {
    gl.getExtension("EXT_color_buffer_float");
    supportLinearFiltering = gl.getExtension("OES_texture_float_linear");
  } else {
    halfFloat = gl.getExtension("OES_texture_half_float");
    supportLinearFiltering = gl.getExtension("OES_texture_half_float_linear");
  }

  gl.clearColor(0.0, 0.0, 0.0, 1.0);

  const halfFloatTexType = isWebGL2 ? gl.HALF_FLOAT : halfFloat.HALF_FLOAT_OES;
  let formatRGBA;
  let formatRG;
  let formatR;

  if (isWebGL2) {
    formatRGBA = getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, halfFloatTexType);
    formatRG = getSupportedFormat(gl, gl.RG16F, gl.RG, halfFloatTexType);
    formatR = getSupportedFormat(gl, gl.R16F, gl.RED, halfFloatTexType);
  } else {
    formatRGBA = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    formatRG = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
    formatR = getSupportedFormat(gl, gl.RGBA, gl.RGBA, halfFloatTexType);
  }

  return {
    gl,
    ext: {
      formatRGBA,
      formatRG,
      formatR,
      halfFloatTexType,
      supportLinearFiltering,
    },
  };
}

function getSupportedFormat(gl, internalFormat, format, type) {
  if (!supportRenderTextureFormat(gl, internalFormat, format, type)) {
    switch (internalFormat) {
      case gl.R16F:
        return getSupportedFormat(gl, gl.RG16F, gl.RG, type);
      case gl.RG16F:
        return getSupportedFormat(gl, gl.RGBA16F, gl.RGBA, type);
      default:
        return null;
    }
  }

  return {
    internalFormat,
    format,
  };
}

function supportRenderTextureFormat(gl, internalFormat, format, type) {
  let texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, 1, 1, 0, format, type, null);

  let fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );

  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  if (status != gl.FRAMEBUFFER_COMPLETE) return false;
  return true;
}

function pointerPrototype() {
  this.id = -1;
  this.x = 0;
  this.y = 0;
  this.dx = 0;
  this.dy = 0;
  this.down = false;
  this.moved = false;
  this.color = [30, 0, 300];
}

pointers.push(new pointerPrototype());

class GLProgram {
  constructor(vertexShader, fragmentShader) {
    this.uniforms = {};
    this.program = gl.createProgram();

    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);

    if (!gl.getProgramParameter(this.program, gl.LINK_STATUS))
      throw gl.getProgramInfoLog(this.program);

    const uniformCount = gl.getProgramParameter(
      this.program,
      gl.ACTIVE_UNIFORMS
    );
    for (let i = 0; i < uniformCount; i++) {
      const uniformName = gl.getActiveUniform(this.program, i).name;
      this.uniforms[uniformName] = gl.getUniformLocation(
        this.program,
        uniformName
      );
    }
  }

  bind() {
    gl.useProgram(this.program);
  }
}

function compileShader(type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
    throw gl.getShaderInfoLog(shader);

  return shader;
}

const baseVertexShader = compileShader(
  gl.VERTEX_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    attribute vec2 aPosition;
    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform vec2 texelSize;

    void main () {
        vUv = aPosition * 0.5 + 0.5;
        vL = vUv - vec2(texelSize.x, 0.0);
        vR = vUv + vec2(texelSize.x, 0.0);
        vT = vUv + vec2(0.0, texelSize.y);
        vB = vUv - vec2(0.0, texelSize.y);
        gl_Position = vec4(aPosition, 0.0, 1.0);
    }
`
);

const clearShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;
    uniform float value;

    void main () {
        gl_FragColor = value * texture2D(uTexture, vUv);
    }
`
);

const displayShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTexture;

    void main () {
        gl_FragColor = texture2D(uTexture, vUv);
    }
`
);

const splatShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uTarget;
    uniform float aspectRatio;
    uniform vec3 color;
    uniform vec2 point;
    uniform float radius;

    void main () {
        vec2 p = vUv - point.xy;
        p.x *= aspectRatio;
        vec3 splat = exp(-dot(p, p) / radius) * color;
        vec3 base = texture2D(uTarget, vUv).xyz;
        gl_FragColor = vec4(base + splat, 1.0);
    }
`
);

const advectionManualFilteringShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    vec4 bilerp (in sampler2D sam, in vec2 p) {
        vec4 st;
        st.xy = floor(p - 0.5) + 0.5;
        st.zw = st.xy + 1.0;
        vec4 uv = st * texelSize.xyxy;
        vec4 a = texture2D(sam, uv.xy);
        vec4 b = texture2D(sam, uv.zy);
        vec4 c = texture2D(sam, uv.xw);
        vec4 d = texture2D(sam, uv.zw);
        vec2 f = p - st.xy;
        return mix(mix(a, b, f.x), mix(c, d, f.x), f.y);
    }

    void main () {
        vec2 coord = gl_FragCoord.xy - dt * texture2D(uVelocity, vUv).xy;
        gl_FragColor = dissipation * bilerp(uSource, coord);
        gl_FragColor.a = 1.0;
    }
`
);

const advectionShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    uniform sampler2D uVelocity;
    uniform sampler2D uSource;
    uniform vec2 texelSize;
    uniform float dt;
    uniform float dissipation;

    void main () {
        vec2 coord = vUv - dt * texture2D(uVelocity, vUv).xy * texelSize;
        gl_FragColor = dissipation * texture2D(uSource, coord);
        gl_FragColor.a = 1.0;
    }
`
);

const divergenceShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    vec2 sampleVelocity (in vec2 uv) {
        vec2 multiplier = vec2(1.0, 1.0);
        if (uv.x < 0.0) { uv.x = 0.0; multiplier.x = -1.0; }
        if (uv.x > 1.0) { uv.x = 1.0; multiplier.x = -1.0; }
        if (uv.y < 0.0) { uv.y = 0.0; multiplier.y = -1.0; }
        if (uv.y > 1.0) { uv.y = 1.0; multiplier.y = -1.0; }
        return multiplier * texture2D(uVelocity, uv).xy;
    }

    void main () {
        float L = sampleVelocity(vL).x;
        float R = sampleVelocity(vR).x;
        float T = sampleVelocity(vT).y;
        float B = sampleVelocity(vB).y;
        float div = 0.5 * (R - L + T - B);
        gl_FragColor = vec4(div, 0.0, 0.0, 1.0);
    }
`
);

const curlShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;

    void main () {
        float L = texture2D(uVelocity, vL).y;
        float R = texture2D(uVelocity, vR).y;
        float T = texture2D(uVelocity, vT).x;
        float B = texture2D(uVelocity, vB).x;
        float vorticity = R - L - T + B;
        gl_FragColor = vec4(vorticity, 0.0, 0.0, 1.0);
    }
`
);

const vorticityShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uVelocity;
    uniform sampler2D uCurl;
    uniform float curl;
    uniform float dt;

    void main () {
        float T = texture2D(uCurl, vT).x;
        float B = texture2D(uCurl, vB).x;
        float C = texture2D(uCurl, vUv).x;
        vec2 force = vec2(abs(T) - abs(B), 0.0);
        force *= 1.0 / length(force + 0.00001) * curl * C;
        vec2 vel = texture2D(uVelocity, vUv).xy;
        gl_FragColor = vec4(vel + force * dt, 0.0, 1.0);
    }
`
);

const pressureShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uDivergence;

    vec2 boundary (in vec2 uv) {
        uv = min(max(uv, 0.0), 1.0);
        return uv;
    }

    void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        float C = texture2D(uPressure, vUv).x;
        float divergence = texture2D(uDivergence, vUv).x;
        float pressure = (L + R + B + T - divergence) * 0.25;
        gl_FragColor = vec4(pressure, 0.0, 0.0, 1.0);
    }
`
);

const gradientSubtractShader = compileShader(
  gl.FRAGMENT_SHADER,
  `
    precision highp float;
    precision mediump sampler2D;

    varying vec2 vUv;
    varying vec2 vL;
    varying vec2 vR;
    varying vec2 vT;
    varying vec2 vB;
    uniform sampler2D uPressure;
    uniform sampler2D uVelocity;

    vec2 boundary (in vec2 uv) {
        uv = min(max(uv, 0.0), 1.0);
        return uv;
    }

    void main () {
        float L = texture2D(uPressure, boundary(vL)).x;
        float R = texture2D(uPressure, boundary(vR)).x;
        float T = texture2D(uPressure, boundary(vT)).x;
        float B = texture2D(uPressure, boundary(vB)).x;
        vec2 velocity = texture2D(uVelocity, vUv).xy;
        velocity.xy -= vec2(R - L, T - B);
        gl_FragColor = vec4(velocity, 0.0, 1.0);
    }
`
);

let textureWidth;
let textureHeight;
let density;
let velocity;
let divergence;
let curl;
let pressure;
initFramebuffers();

const clearProgram = new GLProgram(baseVertexShader, clearShader);
const displayProgram = new GLProgram(baseVertexShader, displayShader);
const splatProgram = new GLProgram(baseVertexShader, splatShader);
const advectionProgram = new GLProgram(
  baseVertexShader,
  ext.supportLinearFiltering ? advectionShader : advectionManualFilteringShader
);
const divergenceProgram = new GLProgram(baseVertexShader, divergenceShader);
const curlProgram = new GLProgram(baseVertexShader, curlShader);
const vorticityProgram = new GLProgram(baseVertexShader, vorticityShader);
const pressureProgram = new GLProgram(baseVertexShader, pressureShader);
const gradienSubtractProgram = new GLProgram(
  baseVertexShader,
  gradientSubtractShader
);

function initFramebuffers() {
  textureWidth = gl.drawingBufferWidth >> config.TEXTURE_DOWNSAMPLE;
  textureHeight = gl.drawingBufferHeight >> config.TEXTURE_DOWNSAMPLE;

  const texType = ext.halfFloatTexType;
  const rgba = ext.formatRGBA;
  const rg = ext.formatRG;
  const r = ext.formatR;

  density = createDoubleFBO(
    2,
    textureWidth,
    textureHeight,
    rgba.internalFormat,
    rgba.format,
    texType,
    ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
  );
  velocity = createDoubleFBO(
    0,
    textureWidth,
    textureHeight,
    rg.internalFormat,
    rg.format,
    texType,
    ext.supportLinearFiltering ? gl.LINEAR : gl.NEAREST
  );
  divergence = createFBO(
    4,
    textureWidth,
    textureHeight,
    r.internalFormat,
    r.format,
    texType,
    gl.NEAREST
  );
  curl = createFBO(
    5,
    textureWidth,
    textureHeight,
    r.internalFormat,
    r.format,
    texType,
    gl.NEAREST
  );
  pressure = createDoubleFBO(
    6,
    textureWidth,
    textureHeight,
    r.internalFormat,
    r.format,
    texType,
    gl.NEAREST
  );
}

function createFBO(texId, w, h, internalFormat, format, type, param) {
  gl.activeTexture(gl.TEXTURE0 + texId);
  let texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, param);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texImage2D(gl.TEXTURE_2D, 0, internalFormat, w, h, 0, format, type, null);

  let fbo = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(
    gl.FRAMEBUFFER,
    gl.COLOR_ATTACHMENT0,
    gl.TEXTURE_2D,
    texture,
    0
  );
  gl.viewport(0, 0, w, h);
  gl.clear(gl.COLOR_BUFFER_BIT);

  return [texture, fbo, texId];
}

function createDoubleFBO(texId, w, h, internalFormat, format, type, param) {
  let fbo1 = createFBO(texId, w, h, internalFormat, format, type, param);
  let fbo2 = createFBO(texId + 1, w, h, internalFormat, format, type, param);

  return {
    get read() {
      return fbo1;
    },
    get write() {
      return fbo2;
    },
    swap() {
      let temp = fbo1;
      fbo1 = fbo2;
      fbo2 = temp;
    },
  };
}

const blit = (() => {
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, -1, 1, 1, 1, 1, -1]),
    gl.STATIC_DRAW
  );
  gl.bindBuffer(gl.ELEMENT_ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ELEMENT_ARRAY_BUFFER,
    new Uint16Array([0, 1, 2, 0, 2, 3]),
    gl.STATIC_DRAW
  );
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  gl.enableVertexAttribArray(0);

  return (destination) => {
    gl.bindFramebuffer(gl.FRAMEBUFFER, destination);
    gl.drawElements(gl.TRIANGLES, 6, gl.UNSIGNED_SHORT, 0);
  };
})();

let lastTime = Date.now();
multipleSplats(parseInt(Math.random() * 20) + 5);
update();

function update() {
  resizeCanvas();

  const dt = Math.min((Date.now() - lastTime) / 1000, 0.016);
  lastTime = Date.now();

  gl.viewport(0, 0, textureWidth, textureHeight);

  if (splatStack.length > 0) multipleSplats(splatStack.pop());

  advectionProgram.bind();
  gl.uniform2f(
    advectionProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, velocity.read[2]);
  gl.uniform1f(advectionProgram.uniforms.dt, dt);
  gl.uniform1f(
    advectionProgram.uniforms.dissipation,
    config.VELOCITY_DISSIPATION
  );
  blit(velocity.write[1]);
  velocity.swap();

  gl.uniform1i(advectionProgram.uniforms.uVelocity, velocity.read[2]);
  gl.uniform1i(advectionProgram.uniforms.uSource, density.read[2]);
  gl.uniform1f(
    advectionProgram.uniforms.dissipation,
    config.DENSITY_DISSIPATION
  );
  blit(density.write[1]);
  density.swap();

  for (let i = 0; i < pointers.length; i++) {
    const pointer = pointers[i];
    if (pointer.moved) {
      splat(pointer.x, pointer.y, pointer.dx, pointer.dy, pointer.color);
      pointer.moved = false;
    }
  }

  curlProgram.bind();
  gl.uniform2f(
    curlProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(curlProgram.uniforms.uVelocity, velocity.read[2]);
  blit(curl[1]);

  vorticityProgram.bind();
  gl.uniform2f(
    vorticityProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(vorticityProgram.uniforms.uVelocity, velocity.read[2]);
  gl.uniform1i(vorticityProgram.uniforms.uCurl, curl[2]);
  gl.uniform1f(vorticityProgram.uniforms.curl, config.CURL);
  gl.uniform1f(vorticityProgram.uniforms.dt, dt);
  blit(velocity.write[1]);
  velocity.swap();

  divergenceProgram.bind();
  gl.uniform2f(
    divergenceProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(divergenceProgram.uniforms.uVelocity, velocity.read[2]);
  blit(divergence[1]);

  clearProgram.bind();
  let pressureTexId = pressure.read[2];
  gl.activeTexture(gl.TEXTURE0 + pressureTexId);
  gl.bindTexture(gl.TEXTURE_2D, pressure.read[0]);
  gl.uniform1i(clearProgram.uniforms.uTexture, pressureTexId);
  gl.uniform1f(clearProgram.uniforms.value, config.PRESSURE_DISSIPATION);
  blit(pressure.write[1]);
  pressure.swap();

  pressureProgram.bind();
  gl.uniform2f(
    pressureProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(pressureProgram.uniforms.uDivergence, divergence[2]);
  pressureTexId = pressure.read[2];
  gl.uniform1i(pressureProgram.uniforms.uPressure, pressureTexId);
  gl.activeTexture(gl.TEXTURE0 + pressureTexId);
  for (let i = 0; i < config.PRESSURE_ITERATIONS; i++) {
    gl.bindTexture(gl.TEXTURE_2D, pressure.read[0]);
    blit(pressure.write[1]);
    pressure.swap();
  }

  gradienSubtractProgram.bind();
  gl.uniform2f(
    gradienSubtractProgram.uniforms.texelSize,
    1.0 / textureWidth,
    1.0 / textureHeight
  );
  gl.uniform1i(gradienSubtractProgram.uniforms.uPressure, pressure.read[2]);
  gl.uniform1i(gradienSubtractProgram.uniforms.uVelocity, velocity.read[2]);
  blit(velocity.write[1]);
  velocity.swap();

  gl.viewport(0, 0, gl.drawingBufferWidth, gl.drawingBufferHeight);
  displayProgram.bind();
  gl.uniform1i(displayProgram.uniforms.uTexture, density.read[2]);
  blit(null);
  requestAnimationFrame(update);
}

function splat(x, y, dx, dy, color) {
  splatProgram.bind();
  gl.uniform1i(splatProgram.uniforms.uTarget, velocity.read[2]);
  gl.uniform1f(splatProgram.uniforms.aspectRatio, canvas.width / canvas.height);
  gl.uniform2f(
    splatProgram.uniforms.point,
    x / canvas.width,
    1.0 - y / canvas.height
  );
  gl.uniform3f(splatProgram.uniforms.color, dx, -dy, 1.0);
  gl.uniform1f(splatProgram.uniforms.radius, config.SPLAT_RADIUS);
  blit(velocity.write[1]);
  velocity.swap();
  gl.uniform1i(splatProgram.uniforms.uTarget, density.read[2]);
  gl.uniform3f(
    splatProgram.uniforms.color,
    color[0] * 0.3,
    color[1] * 0.3,
    color[2] * 0.3
  );
  blit(density.write[1]);
  density.swap();
}

function multipleSplats(amount) {
  for (let i = 0; i < amount; i++) {
    const color = [Math.random() * 176, Math.random() * 54, Math.random() * 54];
    const x = canvas.width * Math.random();
    const y = canvas.height * Math.random();
    const dx = 1000 * (Math.random() - 0.5);
    const dy = 1000 * (Math.random() - 0.5);
    splat(x, y, dx, dy, color);
  }
}

function resizeCanvas() {
  if (
    canvas.width != canvas.clientWidth ||
    canvas.height != canvas.clientHeight
  ) {
    canvas.width = canvas.clientWidth;
    canvas.height = canvas.clientHeight;
    initFramebuffers();
  }
}

canvas.addEventListener("mousemove", (e) => {
  pointers[0].moved = pointers[0].down;
  pointers[0].dx = (e.offsetX - pointers[0].x) * 10.0;
  pointers[0].dy = (e.offsetY - pointers[0].y) * 10.0;
  pointers[0].x = e.offsetX;
  pointers[0].y = e.offsetY;
});

canvas.addEventListener(
  "touchmove",
  (e) => {
    e.preventDefault();
    const touches = e.targetTouches;
    for (let i = 0; i < touches.length; i++) {
      let pointer = pointers[i];
      pointer.moved = pointer.down;
      pointer.dx = (touches[i].pageX - pointer.x) * 10.0;
      pointer.dy = (touches[i].pageY - pointer.y) * 10.0;
      pointer.x = touches[i].pageX;
      pointer.y = touches[i].pageY;
    }
  },
  false
);

canvas.addEventListener("mousemove", () => {
  pointers[0].down = true;
  pointers[0].color = [
    Math.random() + 0.9,
    Math.random() + 0.01,
    Math.random() + 0.01,
  ];
});

canvas.addEventListener("touchstart", (e) => {
  e.preventDefault();
  const touches = e.targetTouches;
  for (let i = 0; i < touches.length; i++) {
    if (i >= pointers.length) pointers.push(new pointerPrototype());

    pointers[i].id = touches[i].identifier;
    pointers[i].down = true;
    pointers[i].x = touches[i].pageX;
    pointers[i].y = touches[i].pageY;
    pointers[i].color = [
      Math.random() + 0.05,
      Math.random() + 0.05,
      Math.random() + 0.05,
    ];
  }
});

window.addEventListener("mouseleave", () => {
  pointers[0].down = false;
});

window.addEventListener("touchend", (e) => {
  const touches = e.changedTouches;
  for (let i = 0; i < touches.length; i++)
    for (let j = 0; j < pointers.length; j++)
      if (touches[i].identifier == pointers[j].id) pointers[j].down = false;
});

let work = [
  {
    title: "Saemushi Software Pvt. Ltd.",
    desc: "Designed and developed offical wesite for the Saemushi Software. It's an Indian Non-Government Company and majorly into providing Business Services.",
    tools: ["HTML5", "CSS3", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/saemushi",
    active: true,
    link: "https://saemushi.com/",
  },
  {
    title: "WDAUS - We Design As You Say",
    desc: "It's a official website for the comapany for which me and my friends planned.",
    tools: ["HTML5", "CSS3", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/wdaus",
    active: true,
    link: "http://wdaus.azurewebsites.net/",
  },
  {
    title: "Audio data capture",
    desc: "An audio capture application which is used to train the ML models to improve the accuracy.",
    tools: ["JavaScript", "React", "Nest", "MongoBD"],
    imgPath: "./assets/images/work/websites/voice",
    active: true,
    link: "https://voice.faceopen.com/",
  },
  {
    title: "TRA-ERF",
    desc: "Designed and developed the official website for T R Anantharaman Education and Research Foundation. This Foundation has been specifically set up to build upon his memorable work and is dedicated to the enhancement of knowledge skills of students.",
    tools: ["HTML5", "CSS3", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/tra",
    active: true,
    link: "https://voice.faceopen.com/",
  },
  {
    title: "Schools Hub",
    desc: "Students management system. Ensures schools keep track of student data in a safe, reliable way.",
    tools: ["PHP", "MySQL", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/schoolshub_admin",
    active: true,
    link: "https://schoolshub.azurewebsites.net/login/index.html",
  },
  {
    title: "Feecorner",
    desc: "An web portal for students to pay the examination fee.",
    tools: ["PHP", "MySQL", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/feecorner",
    active: true,
    link: "https://feecorner.azurewebsites.net/",
  },
  {
    title: "Tamsa Events",
    desc: "We are Service Provider of Events Service, Event Management Services, Exhibition Service, etc.",
    tools: ["HTML", "CSS", "JavaScript", "jQuery"],
    imgPath: "./assets/images/work/websites/tamsa",
    active: false,
  },
  {
    title: "GRIET - Gemz",
    desc: "GRIET e-Magazine (GeM) is an e-nitiative taken by Gokaraju Rangaraju Instittute of Engineering and Technology(GRIET) to encourage e-culture among its students.",
    tools: ["Wordpress", "Dreamhost"],
    imgPath: "./assets/images/work/websites/gemz",
    active: false,
  },
  {
    title: "GRIET - Pragnya",
    desc: "The Annual Technical Fest of GRIET.",
    tools: ["Wordpress", "Dreamhost"],
    imgPath: "./assets/images/work/websites/pragnya",
    active: false,
  },
  {
    title: "GRIET - IEEE",
    desc: "IEEE GRIET SB | Official Website of IEEE GRIET Student Branch.",
    tools: ["Wordpress", "Dreamhost"],
    imgPath: "./assets/images/work/websites/ieee",
    active: false,
  },
  {
    title: "GRIET - MBA",
    desc: "Official website for MBA of GRIET.",
    tools: ["Wordpress", "Dreamhost"],
    imgPath: "./assets/images/work/websites/gemz",
    active: false,
  },
  {
    title: "Proyoung FZC",
    desc: "Official website for Health & Nutrition company Proyoung Nutritional FZC",
    tools: ["HTML5", "CSS3", "JavaScript", "Bootstrap"],
    imgPath: "./assets/images/work/websites/fzc",
    active: false,
  },
  {
    title: "Proyoung International",
    desc: "Dashboard for Proyoung's MLM",
    tools: ["JavaScript", "PHP", "MySQL", "jQuery"],
    imgPath: "./assets/images/work/websites/fzc",
    active: false,
  },
  {
    title: "BQuiz",
    desc: "Web based online examination portal for visually impaired people. Which used web speech and speech synthesis APIs",
    tools: ["SpeechSynthesis", "Web Speech", "JavaScript", "PHP", "MySQL"],
    imgPath: "./assets/images/work/websites/bquiz",
    active: false,
  },
  {
    title: "Govt. Polytechnic College",
    desc: "Official website of Repalle's Government College",
    tools: ["HTML", "CSS", "JavaScript", "jQuery"],
    imgPath: "./assets/images/work/websites/poly",
    active: false,
  },
];

let workHTMLContent = "";

work.forEach((item, index) => {
  workHTMLContent += `
    <div class="ar-card">
    <div class="ar-card-overlay" id="card${index}"></div>
    <div class="ar-card-head">
      <svg
        class="ar-card-icon"
        xmlns="http://www.w3.org/2000/svg"
        viewBox="0 0 512 512"
      >
        <!--! Font Awesome Pro 6.2.1 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license (Commercial License) Copyright 2022 Fonticons, Inc. -->
        <path
          d="M156.6 384.9L125.7 354c-8.5-8.5-11.5-20.8-7.7-32.2c3-8.9 7-20.5 11.8-33.8L24 288c-8.6 0-16.6-4.6-20.9-12.1s-4.2-16.7 .2-24.1l52.5-88.5c13-21.9 36.5-35.3 61.9-35.3l82.3 0c2.4-4 4.8-7.7 7.2-11.3C289.1-4.1 411.1-8.1 483.9 5.3c11.6 2.1 20.6 11.2 22.8 22.8c13.4 72.9 9.3 194.8-111.4 276.7c-3.5 2.4-7.3 4.8-11.3 7.2v82.3c0 25.4-13.4 49-35.3 61.9l-88.5 52.5c-7.4 4.4-16.6 4.5-24.1 .2s-12.1-12.2-12.1-20.9V380.8c-14.1 4.9-26.4 8.9-35.7 11.9c-11.2 3.6-23.4 .5-31.8-7.8zM384 168c22.1 0 40-17.9 40-40s-17.9-40-40-40s-40 17.9-40 40s17.9 40 40 40z"
        />
      </svg>
    </div>
    <div class="ar-card-body">
      <div class="ar-title-with-status">
        <h5>${item.title}</h5>
        <div class="ar-status ${
          item.active ? "ar-active" : "ar-inactive"
        }"></div>
      </div>
      <p>
        ${item.desc}
      </p>
    </div>
    <div class="ar-card-footer">
      <ul>
        ${item.tools?.map((tool) => `<li>${tool}</li>`).join("")}
      </ul>
    </div>
    </div>
    `;
  setTimeout(() => {
    document.getElementById(
      `card${index}`
    ).style.backgroundImage = `url(${item.imgPath}.jpg)`;
  }, 0);
});
document.getElementById("arWorkBody").innerHTML = workHTMLContent;
