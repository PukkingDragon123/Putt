// Self-contained WebGL1 renderer: one flat-shading program, procedural
// primitive meshes, and an allocation-free per-object draw call. The grimy
// PS1/Buckshot look (warm key light, dark fog, film grain, vignette, vertex
// jitter) lives in the fragment/vertex shaders — derived from the STYLE
// FORMULA blocks 3-4 (stylization §8).
import { mat4, mat3 } from "./math.js";

const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform float uJitter;
varying vec3 vNormal;
varying vec3 vWorld;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = uNormalMat * aNormal;
  vec4 clip = uViewProj * world;
  if (uJitter > 0.5) {
    vec2 g = vec2(uJitter);
    clip.xy = floor((clip.xy / clip.w) * g) / g * clip.w;   // PS1 vertex snap
  }
  gl_Position = clip;
}`;

const FS = `
precision mediump float;
varying vec3 vNormal;
varying vec3 vWorld;
uniform vec3 uColor;
uniform float uEmissive;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform float uTime;
uniform vec2 uResolution;
float hash(vec2 p){ return fract(sin(dot(p, vec2(12.9898, 78.233))) * 43758.5453); }
void main() {
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(N, L), 0.0);
  float fill = 0.22 * max(dot(N, vec3(0.0, 1.0, 0.0)), 0.0);
  vec3 lit = uColor * (uLightColor * diff + uAmbient + fill) + uColor * uEmissive;
  float dist = length(vWorld - uCamPos);
  float fog = clamp(1.0 - exp(-uFogDensity * dist), 0.0, 1.0);
  vec3 col = mix(lit, uFogColor, fog);
  float g = hash(gl_FragCoord.xy + vec2(uTime * 60.0));
  col += (g - 0.5) * 0.05;                                   // film grain
  vec2 uv = gl_FragCoord.xy / uResolution;
  float d = length(uv - 0.5);
  col *= smoothstep(0.95, 0.22, d) * 0.5 + 0.5;              // vignette
  gl_FragColor = vec4(col, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS))
    throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}

// ---- procedural mesh builders (non-indexed, flat normals for faceting) ----
function addQuad(P, N, a, b, c, d, n) {
  for (const v of [a, b, c, a, c, d]) { P.push(v[0], v[1], v[2]); N.push(n[0], n[1], n[2]); }
}

function box() {
  const P = [], N = [];
  const v = (x, y, z) => [x, y, z];
  const o = 0.5;
  addQuad(P, N, v(o,-o,-o), v(o,-o,o), v(o,o,o), v(o,o,-o), [1,0,0]);
  addQuad(P, N, v(-o,-o,o), v(-o,-o,-o), v(-o,o,-o), v(-o,o,o), [-1,0,0]);
  addQuad(P, N, v(-o,o,-o), v(o,o,-o), v(o,o,o), v(-o,o,o), [0,1,0]);
  addQuad(P, N, v(-o,-o,o), v(o,-o,o), v(o,-o,-o), v(-o,-o,-o), [0,-1,0]);
  addQuad(P, N, v(o,-o,o), v(-o,-o,o), v(-o,o,o), v(o,o,o), [0,0,1]);
  addQuad(P, N, v(-o,-o,-o), v(o,-o,-o), v(o,o,-o), v(-o,o,-o), [0,0,-1]);
  return { P, N };
}

function planeXZ(seg) {
  const P = [], N = [], n = [0, 1, 0];
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const x0 = i/seg - 0.5, x1 = (i+1)/seg - 0.5, z0 = j/seg - 0.5, z1 = (j+1)/seg - 0.5;
    addQuad(P, N, [x0,0,z0], [x1,0,z0], [x1,0,z1], [x0,0,z1], n);
  }
  return { P, N };
}

function sphere(lat, lon) {
  const P = [], N = [], r = 0.5;
  const pt = (i, j) => {
    const th = Math.PI * i / lat, ph = 2 * Math.PI * j / lon;
    return [r*Math.sin(th)*Math.cos(ph), r*Math.cos(th), r*Math.sin(th)*Math.sin(ph)];
  };
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = pt(i,j), b = pt(i+1,j), c = pt(i+1,j+1), d = pt(i,j+1);
    const cx = (a[0]+b[0]+c[0]+d[0])/4, cy = (a[1]+b[1]+c[1]+d[1])/4, cz = (a[2]+b[2]+c[2]+d[2])/4;
    const l = Math.hypot(cx,cy,cz) || 1, n = [cx/l, cy/l, cz/l];
    addQuad(P, N, a, b, c, d, n);
  }
  return { P, N };
}

function cylinder(seg) {
  const P = [], N = [], r = 0.5, o = 0.5;
  for (let j = 0; j < seg; j++) {
    const a0 = 2*Math.PI*j/seg, a1 = 2*Math.PI*(j+1)/seg;
    const x0 = r*Math.cos(a0), z0 = r*Math.sin(a0), x1 = r*Math.cos(a1), z1 = r*Math.sin(a1);
    const nx = Math.cos((a0+a1)/2), nz = Math.sin((a0+a1)/2);
    addQuad(P, N, [x0,-o,z0], [x1,-o,z1], [x1,o,z1], [x0,o,z0], [nx,0,nz]);
    // caps
    P.push(0,o,0, x0,o,z0, x1,o,z1); N.push(0,1,0, 0,1,0, 0,1,0);
    P.push(0,-o,0, x1,-o,z1, x0,-o,z0); N.push(0,-1,0, 0,-1,0, 0,-1,0);
  }
  return { P, N };
}

function cone(seg) {
  const P = [], N = [], r = 0.5, base = -0.5, apex = 0.5;
  for (let j = 0; j < seg; j++) {
    const a0 = 2*Math.PI*j/seg, a1 = 2*Math.PI*(j+1)/seg;
    const x0 = r*Math.cos(a0), z0 = r*Math.sin(a0), x1 = r*Math.cos(a1), z1 = r*Math.sin(a1);
    const nx = Math.cos((a0+a1)/2), nz = Math.sin((a0+a1)/2);
    P.push(x0,base,z0, x1,base,z1, 0,apex,0);
    N.push(nx,0.5,nz, nx,0.5,nz, nx,0.5,nz);
    P.push(0,base,0, x1,base,z1, x0,base,z0); N.push(0,-1,0, 0,-1,0, 0,-1,0);
  }
  return { P, N };
}

export const PRIMS = { box, planeXZ, sphere, cylinder, cone };

export class Renderer {
  constructor(canvas) {
    const opts = { antialias: true, depth: true, alpha: false, powerPreference: "high-performance" };
    const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl; this.canvas = canvas;
    const prog = gl.createProgram();
    gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VS));
    gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FS));
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS))
      throw new Error("link: " + gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, "aPosition");
    this.aNorm = gl.getAttribLocation(prog, "aNormal");
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aNorm);
    this.u = {};
    for (const name of ["uViewProj","uModel","uNormalMat","uJitter","uColor","uEmissive",
      "uLightDir","uLightColor","uAmbient","uCamPos","uFogColor","uFogDensity","uTime","uResolution"])
      this.u[name] = gl.getUniformLocation(prog, name);
    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.015, 0.02, 0.025, 1);
    // static atmosphere (STYLE FORMULA blocks 3-4: harsh warm bulb, dark cold fog)
    gl.uniform3f(this.u.uLightDir, 0.35, 1.0, 0.25);
    gl.uniform3f(this.u.uLightColor, 1.0, 0.78, 0.5);
    gl.uniform3f(this.u.uAmbient, 0.12, 0.13, 0.18);
    gl.uniform3f(this.u.uFogColor, 0.02, 0.026, 0.032);
    gl.uniform1f(this.u.uFogDensity, 0.022);
    gl.uniform1f(this.u.uJitter, 0); // set per game (PS1 wobble); off by default
    this._m = mat4.create();
    this._n = mat3.create();
    this.meshes = {};
  }

  loadPrimitives() {
    this.meshes.box = this.mesh(PRIMS.box());
    this.meshes.plane = this.mesh(PRIMS.planeXZ(10));
    this.meshes.ball = this.mesh(PRIMS.sphere(10, 12));
    this.meshes.cyl = this.mesh(PRIMS.cylinder(14));
    this.meshes.cylLow = this.mesh(PRIMS.cylinder(8));
    this.meshes.cone = this.mesh(PRIMS.cone(8));
  }

  mesh(data) {
    const gl = this.gl;
    const posBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.P), gl.STATIC_DRAW);
    const normBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, normBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.N), gl.STATIC_DRAW);
    return { posBuf, normBuf, count: data.P.length / 3 };
  }

  resize(dprCap = 1.5) {
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.floor(innerWidth * dpr)), h = Math.max(1, Math.floor(innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.canvas.style.width = innerWidth + "px";
      this.canvas.style.height = innerHeight + "px";
    }
    this.gl.viewport(0, 0, w, h);
    this.gl.uniform2f(this.u.uResolution, w, h);
    this.aspect = w / h;
  }

  setJitter(grid) { this.gl.uniform1f(this.u.uJitter, grid); }

  beginFrame(viewProj, camX, camY, camZ, time) {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform3f(this.u.uCamPos, camX, camY, camZ);
    gl.uniform1f(this.u.uTime, time);
  }

  // Allocation-free: builds model + normal matrices from components in scratch.
  draw(mesh, tx, ty, tz, ry, sx, sy, sz, color, emissive) {
    const gl = this.gl;
    mat4.model(this._m, tx, ty, tz, ry, sx, sy, sz);
    mat3.normalModel(this._n, ry, sx, sy, sz);
    gl.uniformMatrix4fv(this.u.uModel, false, this._m);
    gl.uniformMatrix3fv(this.u.uNormalMat, false, this._n);
    gl.uniform3f(this.u.uColor, color[0], color[1], color[2]);
    gl.uniform1f(this.u.uEmissive, emissive || 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normBuf);
    gl.vertexAttribPointer(this.aNorm, 3, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}
