// Self-contained WebGL1 renderer.
// Scene pass: one flat-shading + texture-modulation program drawing procedural
// primitive meshes into a LOW-RES offscreen framebuffer (chunky 240p pixels).
// Post pass: a fullscreen quad upscales that buffer with NEAREST and applies the
// PSX/CRT survival-horror grade (posterize + Bayer dither, scanlines, chromatic
// aberration, film grain, vignette, VHS roll). All look comes from the shaders +
// procedural textures — no external assets (STYLE FORMULA, stylization §8).
import { mat4, mat3 } from "./math.js";
import { TEX_BUILDERS } from "./textures.js";

// ---- scene program ----
const VS = `
attribute vec3 aPosition;
attribute vec3 aNormal;
attribute vec2 aUV;
uniform mat4 uViewProj;
uniform mat4 uModel;
uniform mat3 uNormalMat;
uniform float uJitter;
uniform vec2 uUVScale;
varying vec3 vNormal;
varying vec3 vWorld;
varying vec2 vUV;
void main() {
  vec4 world = uModel * vec4(aPosition, 1.0);
  vWorld = world.xyz;
  vNormal = uNormalMat * aNormal;
  vUV = aUV * uUVScale;
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
varying vec2 vUV;
uniform vec3 uColor;
uniform float uEmissive;
uniform vec3 uLightDir;
uniform vec3 uLightColor;
uniform vec3 uAmbient;
uniform vec3 uCamPos;
uniform vec3 uFogColor;
uniform float uFogDensity;
uniform sampler2D uTex;
uniform float uUseTex;
void main() {
  vec3 base = uColor;
  float a = 1.0;
  if (uUseTex > 0.5) { vec4 t = texture2D(uTex, vUV); base = uColor * (t.rgb * 2.0); a = t.a; }
  vec3 N = normalize(vNormal);
  vec3 L = normalize(uLightDir);
  float diff = max(dot(N, L), 0.0);
  float fill = 0.22 * max(dot(N, vec3(0.0, 1.0, 0.0)), 0.0);
  vec3 lit = base * (uLightColor * diff + uAmbient + fill) + base * uEmissive;
  float dist = length(vWorld - uCamPos);
  float fog = clamp(1.0 - exp(-uFogDensity * dist), 0.0, 1.0);
  vec3 col = mix(lit, uFogColor, fog);   // grain + vignette now owned by post pass
  gl_FragColor = vec4(col, a);
}`;

// ---- post program ----
const POST_VS = `
attribute vec2 aPos;
varying vec2 vUv;
void main() { vUv = aPos * 0.5 + 0.5; gl_Position = vec4(aPos, 0.0, 1.0); }`;

const POST_FS = `
precision mediump float;
varying vec2 vUv;
uniform sampler2D uScene;
uniform vec2 uTexel;
uniform vec2 uOutRes;
uniform float uTime;
uniform float uLevels, uCA, uScan, uGrain, uVig, uBarrel, uRoll;
float hash12(vec2 p){ p = fract(p * vec2(443.897, 441.423)); p += dot(p, p + 19.19); return fract(p.x * p.y); }
float bayer4(vec2 fragPx){
  int x = int(mod(fragPx.x, 4.0)), y = int(mod(fragPx.y, 4.0)), i = x + y * 4;
  float m;
       if(i== 0)m= 0.0;  else if(i== 1)m= 8.0;  else if(i== 2)m= 2.0;  else if(i== 3)m=10.0;
  else if(i== 4)m=12.0;  else if(i== 5)m= 4.0;  else if(i== 6)m=14.0;  else if(i== 7)m= 6.0;
  else if(i== 8)m= 3.0;  else if(i== 9)m=11.0;  else if(i==10)m= 1.0;  else if(i==11)m= 9.0;
  else if(i==12)m=15.0;  else if(i==13)m= 7.0;  else if(i==14)m=13.0;  else m= 5.0;
  return (m + 0.5) / 16.0 - 0.5;
}
void main() {
  float t = mod(uTime, 100.0);
  vec2 uv = vUv;
  if (uBarrel > 0.0001) { vec2 cc = uv - 0.5; uv = 0.5 + cc * (1.0 + uBarrel * dot(cc, cc)); }
  if (uRoll > 0.0001) {
    float band = sin(uv.y * 2.0 + t * 0.6);
    float row = floor(uv.y * uOutRes.y);
    float jit = (hash12(vec2(row, floor(t * 18.0))) - 0.5);
    uv.x += (jit * 0.0018 + band * 0.0009) * uRoll;
  }
  vec2 edge = step(0.0, uv) * step(uv, vec2(1.0));
  float inside = edge.x * edge.y;
  vec2 off = (uv - 0.5) * uCA * uTexel;
  vec3 col = vec3(texture2D(uScene, uv + off).r, texture2D(uScene, uv).g, texture2D(uScene, uv - off).b);
  vec2 fragPx = gl_FragCoord.xy;
  float d = bayer4(fragPx) / uLevels;
  col = floor(col * uLevels + 0.5 + d * uLevels) / uLevels;
  float sl = sin(fragPx.y * 3.14159265) * 0.5 + 0.5;
  col *= 1.0 - uScan * sl;
  col *= mix(1.0, smoothstep(1.15, 0.3, length(vUv - 0.5)), uVig);
  col += (hash12(fragPx + vec2(t * 57.0, t * 31.0)) - 0.5) * uGrain;
  gl_FragColor = vec4(col * inside, 1.0);
}`;

function compile(gl, type, src) {
  const s = gl.createShader(type);
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
  return s;
}
function link(gl, vs, fs) {
  const p = gl.createProgram();
  gl.attachShader(p, compile(gl, gl.VERTEX_SHADER, vs));
  gl.attachShader(p, compile(gl, gl.FRAGMENT_SHADER, fs));
  gl.linkProgram(p);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
  return p;
}

// ---- procedural meshes (non-indexed, flat normals; UVs for texturing) ----
function addQuad(P, N, U, a, b, c, d, n, uvA, uvB, uvC, uvD) {
  const vs = [a, b, c, a, c, d], uv = [uvA, uvB, uvC, uvA, uvC, uvD];
  for (let k = 0; k < 6; k++) { P.push(vs[k][0], vs[k][1], vs[k][2]); N.push(n[0], n[1], n[2]); U.push(uv[k][0], uv[k][1]); }
}
function box() {
  const P = [], N = [], U = [], v = (x, y, z) => [x, y, z], o = 0.5;
  addQuad(P,N,U, v(o,-o,-o),v(o,-o,o),v(o,o,o),v(o,o,-o), [1,0,0],  [0,0],[1,0],[1,1],[0,1]);
  addQuad(P,N,U, v(-o,-o,o),v(-o,-o,-o),v(-o,o,-o),v(-o,o,o), [-1,0,0], [0,0],[1,0],[1,1],[0,1]);
  addQuad(P,N,U, v(-o,o,-o),v(o,o,-o),v(o,o,o),v(-o,o,o), [0,1,0],  [0,0],[1,0],[1,1],[0,1]);
  addQuad(P,N,U, v(-o,-o,o),v(o,-o,o),v(o,-o,-o),v(-o,-o,-o), [0,-1,0], [0,0],[1,0],[1,1],[0,1]);
  addQuad(P,N,U, v(o,-o,o),v(-o,-o,o),v(-o,o,o),v(o,o,o), [0,0,1],  [0,0],[1,0],[1,1],[0,1]);
  addQuad(P,N,U, v(-o,-o,-o),v(o,-o,-o),v(o,o,-o),v(-o,o,-o), [0,0,-1], [0,0],[1,0],[1,1],[0,1]);
  return { P, N, U };
}
function planeXZ(seg) {
  const P = [], N = [], U = [], n = [0, 1, 0];
  for (let i = 0; i < seg; i++) for (let j = 0; j < seg; j++) {
    const x0 = i/seg-0.5, x1 = (i+1)/seg-0.5, z0 = j/seg-0.5, z1 = (j+1)/seg-0.5;
    const u0 = i/seg, u1 = (i+1)/seg, v0 = j/seg, v1 = (j+1)/seg;
    addQuad(P,N,U, [x0,0,z0],[x1,0,z0],[x1,0,z1],[x0,0,z1], n, [u0,v0],[u1,v0],[u1,v1],[u0,v1]);
  }
  return { P, N, U };
}
function sphere(lat, lon) {
  const P = [], N = [], U = [], r = 0.5;
  const pt = (i, j) => { const th = Math.PI*i/lat, ph = 2*Math.PI*j/lon; return [r*Math.sin(th)*Math.cos(ph), r*Math.cos(th), r*Math.sin(th)*Math.sin(ph)]; };
  const uv = (i, j) => [j/lon, i/lat];
  for (let i = 0; i < lat; i++) for (let j = 0; j < lon; j++) {
    const a = pt(i,j), b = pt(i+1,j), c = pt(i+1,j+1), d = pt(i,j+1);
    const cx=(a[0]+b[0]+c[0]+d[0])/4, cy=(a[1]+b[1]+c[1]+d[1])/4, cz=(a[2]+b[2]+c[2]+d[2])/4, l=Math.hypot(cx,cy,cz)||1, n=[cx/l,cy/l,cz/l];
    addQuad(P,N,U, a,b,c,d, n, uv(i,j),uv(i+1,j),uv(i+1,j+1),uv(i,j+1));
  }
  return { P, N, U };
}
function cylinder(seg) {
  const P = [], N = [], U = [], r = 0.5, o = 0.5;
  for (let j = 0; j < seg; j++) {
    const a0 = 2*Math.PI*j/seg, a1 = 2*Math.PI*(j+1)/seg;
    const x0 = r*Math.cos(a0), z0 = r*Math.sin(a0), x1 = r*Math.cos(a1), z1 = r*Math.sin(a1);
    const nx = Math.cos((a0+a1)/2), nz = Math.sin((a0+a1)/2), u0 = j/seg, u1 = (j+1)/seg;
    addQuad(P,N,U, [x0,-o,z0],[x1,-o,z1],[x1,o,z1],[x0,o,z0], [nx,0,nz], [u0,0],[u1,0],[u1,1],[u0,1]);
    const cu0=0.5+x0, cv0=0.5+z0, cu1=0.5+x1, cv1=0.5+z1;
    P.push(0,o,0, x0,o,z0, x1,o,z1); N.push(0,1,0,0,1,0,0,1,0); U.push(0.5,0.5, cu0,cv0, cu1,cv1);
    P.push(0,-o,0, x1,-o,z1, x0,-o,z0); N.push(0,-1,0,0,-1,0,0,-1,0); U.push(0.5,0.5, cu1,cv1, cu0,cv0);
  }
  return { P, N, U };
}
function cone(seg) {
  const P = [], N = [], U = [], r = 0.5, base = -0.5, apex = 0.5;
  for (let j = 0; j < seg; j++) {
    const a0 = 2*Math.PI*j/seg, a1 = 2*Math.PI*(j+1)/seg;
    const x0 = r*Math.cos(a0), z0 = r*Math.sin(a0), x1 = r*Math.cos(a1), z1 = r*Math.sin(a1);
    const nx = Math.cos((a0+a1)/2), nz = Math.sin((a0+a1)/2), u0 = j/seg, u1 = (j+1)/seg;
    P.push(x0,base,z0, x1,base,z1, 0,apex,0); N.push(nx,0.5,nz, nx,0.5,nz, nx,0.5,nz); U.push(u0,0, u1,0, (u0+u1)*0.5,1);
    const cu0=0.5+x0, cv0=0.5+z0, cu1=0.5+x1, cv1=0.5+z1;
    P.push(0,base,0, x1,base,z1, x0,base,z0); N.push(0,-1,0,0,-1,0,0,-1,0); U.push(0.5,0.5, cu1,cv1, cu0,cv0);
  }
  return { P, N, U };
}
// vertical discs (XY plane) used flat-coloured for the torture props
function _discTri(P, N, U, a, b, c) {
  const ux=b[0]-a[0],uy=b[1]-a[1],uz=b[2]-a[2], vx=c[0]-a[0],vy=c[1]-a[1],vz=c[2]-a[2];
  let nx=uy*vz-uz*vy, ny=uz*vx-ux*vz, nz=ux*vy-uy*vx; const l=Math.hypot(nx,ny,nz)||1; nx/=l; ny/=l; nz/=l;
  for (const v of [a,b,c]) { P.push(v[0],v[1],v[2]); N.push(nx,ny,nz); U.push(0,0); }
}
function spikeWheel(seg) {
  const P = [], N = [], U = [], R = 0.5, spike = 0.16;
  for (let j = 0; j < seg; j++) {
    const a0=2*Math.PI*j/seg, a1=2*Math.PI*(j+1)/seg, am=(a0+a1)/2;
    const r0=[R*Math.cos(a0),R*Math.sin(a0),0], r1=[R*Math.cos(a1),R*Math.sin(a1),0];
    _discTri(P,N,U, [0,0,0.1], r0, r1); _discTri(P,N,U, [0,0,-0.1], r1, r0);
    _discTri(P,N,U, r0, [(R+spike)*Math.cos(am),(R+spike)*Math.sin(am),0], r1);
  }
  return { P, N, U };
}
function sawBlade(seg) {
  const P = [], N = [], U = [], R = 0.5;
  for (let j = 0; j < seg; j++) {
    const a0=2*Math.PI*j/seg, a1=2*Math.PI*(j+1)/seg, am=(a0+a1)/2;
    const r0=[R*Math.cos(a0),R*Math.sin(a0),0], r1=[R*Math.cos(a1),R*Math.sin(a1),0];
    _discTri(P,N,U, [0,0,0.02], r0, r1); _discTri(P,N,U, [0,0,-0.02], r1, r0);
    _discTri(P,N,U, r0, [(R+0.12)*Math.cos(am),(R+0.12)*Math.sin(am),0], r1);
  }
  return { P, N, U };
}

export const PRIMS = { box, planeXZ, sphere, cylinder, cone, spikeWheel, sawBlade };

export class Renderer {
  constructor(canvas) {
    const opts = { antialias: false, depth: true, alpha: false, powerPreference: "high-performance" };
    const gl = canvas.getContext("webgl", opts) || canvas.getContext("experimental-webgl", opts);
    if (!gl) throw new Error("WebGL not available");
    this.gl = gl; this.canvas = canvas;

    const prog = link(gl, VS, FS);
    gl.useProgram(prog);
    this.prog = prog;
    this.aPos = gl.getAttribLocation(prog, "aPosition");
    this.aNorm = gl.getAttribLocation(prog, "aNormal");
    this.aUV = gl.getAttribLocation(prog, "aUV");
    gl.enableVertexAttribArray(this.aPos);
    gl.enableVertexAttribArray(this.aNorm);
    gl.enableVertexAttribArray(this.aUV);
    this.u = {};
    for (const n of ["uViewProj","uModel","uNormalMat","uJitter","uColor","uEmissive","uLightDir",
      "uLightColor","uAmbient","uCamPos","uFogColor","uFogDensity","uUVScale","uTex","uUseTex"])
      this.u[n] = gl.getUniformLocation(prog, n);

    gl.enable(gl.DEPTH_TEST);
    gl.disable(gl.CULL_FACE);
    gl.clearColor(0.012, 0.016, 0.02, 1);
    // atmosphere (STYLE FORMULA blocks 3-4: one harsh warm bulb, cold basement fog)
    gl.uniform3f(this.u.uLightDir, 0.3, 1.0, 0.22);
    gl.uniform3f(this.u.uLightColor, 1.35, 1.08, 0.74);
    gl.uniform3f(this.u.uAmbient, 0.4, 0.41, 0.47);
    gl.uniform3f(this.u.uFogColor, 0.035, 0.04, 0.05);
    gl.uniform1f(this.u.uFogDensity, 0.011);
    gl.uniform1f(this.u.uJitter, 0);
    gl.uniform1i(this.u.uTex, 0);
    gl.uniform1f(this.u.uUseTex, 0);
    gl.uniform2f(this.u.uUVScale, 1, 1);

    // post program
    const post = link(gl, POST_VS, POST_FS);
    this.post = post;
    this.pAPos = gl.getAttribLocation(post, "aPos");
    this.pu = {};
    for (const n of ["uScene","uTexel","uOutRes","uTime","uLevels","uCA","uScan","uGrain","uVig","uBarrel","uRoll"])
      this.pu[n] = gl.getUniformLocation(post, n);
    this.quadBuf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1,-1, 1,-1, -1,1, -1,1, 1,-1, 1,1]), gl.STATIC_DRAW);
    gl.useProgram(post);
    gl.uniform1i(this.pu.uScene, 0);
    gl.uniform1f(this.pu.uLevels, 22.0);
    gl.uniform1f(this.pu.uCA, 1.3);
    gl.uniform1f(this.pu.uScan, 0.2);
    gl.uniform1f(this.pu.uGrain, 0.07);
    gl.uniform1f(this.pu.uVig, 0.55);
    gl.uniform1f(this.pu.uBarrel, 0.05);
    gl.uniform1f(this.pu.uRoll, 1.0);
    gl.useProgram(prog);

    this.pixelHeight = 300; // lower = chunkier
    this.scene = null;
    this._m = mat4.create(); this._n = mat3.create();
    this.meshes = {}; this.textures = {};
    this._curTex = null; this._curUseTex = -1; this._time = 0;
  }

  loadPrimitives() {
    this.meshes.box = this.mesh(PRIMS.box());
    this.meshes.plane = this.mesh(PRIMS.planeXZ(10));
    this.meshes.ball = this.mesh(PRIMS.sphere(10, 12));
    this.meshes.cyl = this.mesh(PRIMS.cylinder(14));
    this.meshes.cylLow = this.mesh(PRIMS.cylinder(8));
    this.meshes.cone = this.mesh(PRIMS.cone(8));
    this.meshes.wheel = this.mesh(PRIMS.spikeWheel(10));
    this.meshes.saw = this.mesh(PRIMS.sawBlade(16));
  }

  loadTextures() {
    const gl = this.gl;
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
    for (const name in TEX_BUILDERS) {
      const canvas = TEX_BUILDERS[name]();
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.REPEAT);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.generateMipmap(gl.TEXTURE_2D); // 256x256 POT
      this.textures[name] = tex;
    }
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
    this._curTex = null;
  }

  mesh(data) {
    const gl = this.gl;
    const count = data.P.length / 3;
    const uvLen = count * 2;
    const Ud = (data.U && data.U.length === uvLen) ? data.U : new Float32Array(uvLen);
    const posBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, posBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.P), gl.STATIC_DRAW);
    const normBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, normBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(data.N), gl.STATIC_DRAW);
    const uvBuf = gl.createBuffer(); gl.bindBuffer(gl.ARRAY_BUFFER, uvBuf); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(Ud), gl.STATIC_DRAW);
    return { posBuf, normBuf, uvBuf, count };
  }

  _makeScene(w, h) {
    const gl = this.gl;
    if (this.scene) { gl.deleteFramebuffer(this.scene.fb); gl.deleteTexture(this.scene.tex); gl.deleteRenderbuffer(this.scene.depth); }
    const fb = gl.createFramebuffer();
    gl.bindFramebuffer(gl.FRAMEBUFFER, fb);
    const tex = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, w, h, 0, gl.RGBA, gl.UNSIGNED_BYTE, null);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
    const depth = gl.createRenderbuffer();
    gl.bindRenderbuffer(gl.RENDERBUFFER, depth);
    gl.renderbufferStorage(gl.RENDERBUFFER, gl.DEPTH_COMPONENT16, w, h);
    gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.DEPTH_ATTACHMENT, gl.RENDERBUFFER, depth);
    const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.bindTexture(gl.TEXTURE_2D, null);
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    if (status !== gl.FRAMEBUFFER_COMPLETE) throw new Error("scene FBO incomplete: 0x" + status.toString(16));
    this._curTex = null;
    this.scene = { fb, tex, depth, w, h };
  }

  resize(dprCap = 1.5) {
    const gl = this.gl;
    const dpr = Math.min(window.devicePixelRatio || 1, dprCap);
    const w = Math.max(1, Math.floor(innerWidth * dpr)), h = Math.max(1, Math.floor(innerHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w; this.canvas.height = h;
      this.canvas.style.width = innerWidth + "px"; this.canvas.style.height = innerHeight + "px";
    }
    this.outW = w; this.outH = h; this.aspect = w / h;
    const sh = Math.max(1, Math.round(this.pixelHeight)), sw = Math.max(1, Math.round(sh * this.aspect));
    if (!this.scene || this.scene.w !== sw || this.scene.h !== sh) this._makeScene(sw, sh);
    gl.useProgram(this.post);
    gl.uniform2f(this.pu.uTexel, 1 / sw, 1 / sh);
    gl.uniform2f(this.pu.uOutRes, w, h);
    gl.useProgram(this.prog);
  }

  setJitter(grid) { this.gl.useProgram(this.prog); this.gl.uniform1f(this.u.uJitter, grid); }
  setPixelHeight(px) { this.pixelHeight = px; this.resize(); }

  beginFrame(viewProj, camX, camY, camZ, time) {
    const gl = this.gl;
    gl.useProgram(this.prog);
    gl.bindFramebuffer(gl.FRAMEBUFFER, this.scene.fb);
    gl.viewport(0, 0, this.scene.w, this.scene.h);
    gl.enable(gl.DEPTH_TEST); gl.depthMask(true);
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    gl.uniformMatrix4fv(this.u.uViewProj, false, viewProj);
    gl.uniform3f(this.u.uCamPos, camX, camY, camZ);
    this._time = time;
  }

  present(time) {
    const gl = this.gl;
    gl.bindFramebuffer(gl.FRAMEBUFFER, null);
    gl.viewport(0, 0, this.outW, this.outH);
    gl.useProgram(this.post);
    gl.disable(gl.DEPTH_TEST); gl.disable(gl.BLEND);
    gl.uniform1f(this.pu.uTime, time !== undefined ? time : this._time);
    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, this.scene.tex);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuf);
    gl.enableVertexAttribArray(this.pAPos);
    gl.vertexAttribPointer(this.pAPos, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, 6);
    gl.useProgram(this.prog);
    this._curTex = null; // post bound its own texture; force rebind next scene draw
  }

  // transparent decals (blood): src-alpha blend, no depth write
  blend(on) {
    const gl = this.gl;
    if (on) { gl.enable(gl.BLEND); gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA); gl.depthMask(false); }
    else { gl.disable(gl.BLEND); gl.depthMask(true); }
  }

  draw(mesh, tx, ty, tz, ry, sx, sy, sz, color, emissive, tex, uvScale) {
    const gl = this.gl;
    mat4.model(this._m, tx, ty, tz, ry, sx, sy, sz);
    mat3.normalModel(this._n, ry, sx, sy, sz);
    gl.uniformMatrix4fv(this.u.uModel, false, this._m);
    gl.uniformMatrix3fv(this.u.uNormalMat, false, this._n);
    gl.uniform3f(this.u.uColor, color[0], color[1], color[2]);
    gl.uniform1f(this.u.uEmissive, emissive || 0);
    const useTex = tex ? 1 : 0;
    if (useTex !== this._curUseTex) { gl.uniform1f(this.u.uUseTex, useTex); this._curUseTex = useTex; }
    if (tex) {
      if (tex !== this._curTex) { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, tex); this._curTex = tex; }
      gl.uniform2f(this.u.uUVScale, uvScale ? uvScale[0] : 1, uvScale ? uvScale[1] : 1);
    }
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.posBuf); gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.normBuf); gl.vertexAttribPointer(this.aNorm, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, mesh.uvBuf); gl.vertexAttribPointer(this.aUV, 2, gl.FLOAT, false, 0, 0);
    gl.drawArrays(gl.TRIANGLES, 0, mesh.count);
  }
}
