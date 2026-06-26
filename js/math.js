// Minimal mat4 / mat3 / vec3 math for the WebGL renderer. Column-major,
// compatible with WebGL uniformMatrix*fv (transpose=false). Reusable scratch
// matrices keep the frame loop allocation-free (§6.5).

export const mat4 = {
  create() { const m = new Float32Array(16); m[0] = m[5] = m[10] = m[15] = 1; return m; },

  identity(o) { o.fill(0); o[0] = o[5] = o[10] = o[15] = 1; return o; },

  multiply(o, a, b) {
    const a00=a[0],a01=a[1],a02=a[2],a03=a[3], a10=a[4],a11=a[5],a12=a[6],a13=a[7],
          a20=a[8],a21=a[9],a22=a[10],a23=a[11], a30=a[12],a31=a[13],a32=a[14],a33=a[15];
    for (let i = 0; i < 4; i++) {
      const b0=b[i*4],b1=b[i*4+1],b2=b[i*4+2],b3=b[i*4+3];
      o[i*4]   = b0*a00 + b1*a10 + b2*a20 + b3*a30;
      o[i*4+1] = b0*a01 + b1*a11 + b2*a21 + b3*a31;
      o[i*4+2] = b0*a02 + b1*a12 + b2*a22 + b3*a32;
      o[i*4+3] = b0*a03 + b1*a13 + b2*a23 + b3*a33;
    }
    return o;
  },

  perspective(o, fovy, aspect, near, far) {
    const f = 1 / Math.tan(fovy / 2), nf = 1 / (near - far);
    o.fill(0);
    o[0] = f / aspect; o[5] = f; o[10] = (far + near) * nf;
    o[11] = -1; o[14] = 2 * far * near * nf;
    return o;
  },

  lookAt(o, eye, center, up) {
    let zx = eye[0]-center[0], zy = eye[1]-center[1], zz = eye[2]-center[2];
    let zl = Math.hypot(zx, zy, zz) || 1; zx/=zl; zy/=zl; zz/=zl;
    let xx = up[1]*zz - up[2]*zy, xy = up[2]*zx - up[0]*zz, xz = up[0]*zy - up[1]*zx;
    let xl = Math.hypot(xx, xy, xz) || 1; xx/=xl; xy/=xl; xz/=xl;
    const yx = zy*xz - zz*xy, yy = zz*xx - zx*xz, yz = zx*xy - zy*xx;
    o[0]=xx; o[1]=yx; o[2]=zx; o[3]=0;
    o[4]=xy; o[5]=yy; o[6]=zy; o[7]=0;
    o[8]=xz; o[9]=yz; o[10]=zz; o[11]=0;
    o[12]=-(xx*eye[0]+xy*eye[1]+xz*eye[2]);
    o[13]=-(yx*eye[0]+yy*eye[1]+yz*eye[2]);
    o[14]=-(zx*eye[0]+zy*eye[1]+zz*eye[2]);
    o[15]=1;
    return o;
  },

  // Compose translation * rotationY * scale into o (the common per-object case).
  model(o, tx, ty, tz, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry);
    o[0] = c*sx;  o[1] = 0;   o[2] = -s*sx; o[3] = 0;
    o[4] = 0;     o[5] = sy;  o[6] = 0;     o[7] = 0;
    o[8] = s*sz;  o[9] = 0;   o[10]= c*sz;  o[11]= 0;
    o[12]= tx;    o[13]= ty;  o[14]= tz;    o[15]= 1;
    return o;
  },
};

export const mat3 = {
  create() { const m = new Float32Array(9); m[0]=m[4]=m[8]=1; return m; },

  // Normal matrix for a translate*rotateY*scale model: N = R * S^-1 (column-major).
  // Exact and allocation-free; the shader renormalizes, so only direction matters.
  normalModel(o, ry, sx, sy, sz) {
    const c = Math.cos(ry), s = Math.sin(ry), ix = 1/sx, iy = 1/sy, iz = 1/sz;
    o[0] = c*ix;  o[1] = 0;    o[2] = -s*ix;
    o[3] = 0;     o[4] = iy;   o[5] = 0;
    o[6] = s*iz;  o[7] = 0;    o[8] = c*iz;
    return o;
  },
  // Normal matrix = inverse-transpose of the upper-left 3x3 of a mat4.
  normalFromMat4(o, a) {
    const a00=a[0],a01=a[1],a02=a[2], a10=a[4],a11=a[5],a12=a[6], a20=a[8],a21=a[9],a22=a[10];
    const b01 =  a22*a11 - a12*a21, b11 = -a22*a10 + a12*a20, b21 =  a21*a10 - a11*a20;
    let det = a00*b01 + a01*b11 + a02*b21;
    if (!det) { o[0]=o[4]=o[8]=1; o[1]=o[2]=o[3]=o[5]=o[6]=o[7]=0; return o; }
    det = 1 / det;
    o[0] = b01*det;                    o[1] = (-a22*a01 + a02*a21)*det; o[2] = (a12*a01 - a02*a11)*det;
    o[3] = b11*det;                    o[4] = (a22*a00 - a02*a20)*det;  o[5] = (-a12*a00 + a02*a10)*det;
    o[6] = b21*det;                    o[7] = (-a21*a00 + a01*a20)*det; o[8] = (a11*a00 - a01*a10)*det;
    return o;
  },
};
