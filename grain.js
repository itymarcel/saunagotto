(function () {
  'use strict';

  const canvas = document.querySelector('.logo-grain');
  const ctx = canvas.getContext('2d');
  /* Use the base logo image as the alpha mask source             */
  const logoImg = document.querySelector('.logo-jp.base');
  let w = 1, h = 1;

  /* Draw at half display resolution for a chunky analogue-static
     pixel size (~2 screen pixels per noise texel).               */
  function resize() {
    const rect = canvas.getBoundingClientRect();
    w = Math.max(1, Math.floor(rect.width * 0.5));
    h = Math.max(1, Math.floor(rect.height * 0.5));
    canvas.width = w;
    canvas.height = h;
  }

  window.addEventListener('resize', resize);
  requestAnimationFrame(() => { resize(); tick(); });

  function tick() {
    /* 1. Fill with random greyscale noise                         */
    const img = ctx.createImageData(w, h);
    const buf = img.data;
    for (let i = 0; i < buf.length; i += 4) {
      const v = Math.random() * 255 | 0;
      buf[i] = v;
      buf[i + 1] = v;
      buf[i + 2] = v;
      buf[i + 3] = 255;
    }
    ctx.putImageData(img, 0, 0);

    /* 2. Punch out transparent areas: keep noise only where the
          logo PNG is opaque (destination-in = multiply alphas).  */
    ctx.globalCompositeOperation = 'destination-in';
    ctx.drawImage(logoImg, 0, 0, w, h);
    ctx.globalCompositeOperation = 'source-over';

    requestAnimationFrame(tick);
  }

}());
