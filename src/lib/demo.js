// An authored example image; never uploaded or fetched from a third party.
export function createDemo() {
  const canvas = document.createElement('canvas');
  canvas.width = 960;
  canvas.height = 720;
  const c = canvas.getContext('2d');
  const bg = c.createLinearGradient(0, 0, 960, 720);
  bg.addColorStop(0, '#f7ddd9');
  bg.addColorStop(0.55, '#f3d0ce');
  bg.addColorStop(1, '#eab8b9');
  c.fillStyle = bg;
  c.fillRect(0, 0, 960, 720);
  const ellipse = (x, y, rx, ry, fill) => {
    c.beginPath();
    c.ellipse(x, y, rx, ry, 0, 0, Math.PI * 2);
    c.fillStyle = fill;
    c.fill();
  };
  c.save();
  c.filter = 'blur(22px)';
  ellipse(495, 565, 261, 49, '#b2747580');
  c.restore();
  const plate = c.createLinearGradient(0, 430, 0, 620);
  plate.addColorStop(0, '#fffaf4');
  plate.addColorStop(0.7, '#f8ece2');
  plate.addColorStop(1, '#d8b9ae');
  ellipse(480, 528, 306, 96, plate);
  ellipse(480, 514, 294, 84, '#fff8ef');
  c.strokeStyle = '#e9d4c4';
  c.lineWidth = 2;
  c.beginPath();
  c.ellipse(480, 516, 260, 67, 0, 0, Math.PI * 2);
  c.stroke();
  const sauce = c.createRadialGradient(477, 510, 20, 480, 510, 204);
  sauce.addColorStop(0, '#85401e');
  sauce.addColorStop(0.65, '#b66a35');
  sauce.addColorStop(1, '#cf8b4b');
  ellipse(480, 516, 201, 55, sauce);
  c.save();
  c.filter = 'blur(9px)';
  ellipse(481, 514, 155, 27, '#63280e90');
  c.restore();
  const body = c.createLinearGradient(300, 0, 658, 0);
  body.addColorStop(0, '#ce8a3e');
  body.addColorStop(0.13, '#f4cb73');
  body.addColorStop(0.34, '#ffe5a0');
  body.addColorStop(0.6, '#f6d488');
  body.addColorStop(0.84, '#e5b463');
  body.addColorStop(1, '#b77332');
  c.beginPath();
  c.moveTo(365, 300);
  c.bezierCurveTo(360, 365, 330, 435, 319, 488);
  c.bezierCurveTo(321, 551, 637, 552, 642, 488);
  c.bezierCurveTo(626, 425, 606, 356, 595, 300);
  c.closePath();
  c.fillStyle = body;
  c.fill();
  c.save();
  c.clip();
  for (let i = 0; i < 9; i++) {
    const x = 330 + i * 37;
    const g = c.createLinearGradient(x, 0, x + 33, 0);
    g.addColorStop(0, '#fff0b100');
    g.addColorStop(0.5, '#fff0b155');
    g.addColorStop(1, '#92561b15');
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(380 + (i - 4) * 26, 310);
    c.lineTo(x + 35, 534);
    c.lineTo(x, 534);
    c.closePath();
    c.fill();
  }
  const shade = c.createLinearGradient(0, 390, 0, 550);
  shade.addColorStop(0, '#b97c2200');
  shade.addColorStop(1, '#b97c2245');
  c.fillStyle = shade;
  c.fillRect(300, 300, 350, 250);
  c.restore();
  const caramel = c.createLinearGradient(360, 254, 570, 340);
  caramel.addColorStop(0, '#a95325');
  caramel.addColorStop(0.42, '#b66a30');
  caramel.addColorStop(1, '#703418');
  c.beginPath();
  c.moveTo(365, 299);
  c.bezierCurveTo(358, 277, 401, 254, 479, 253);
  c.bezierCurveTo(552, 251, 594, 274, 596, 297);
  c.bezierCurveTo(600, 316, 584, 325, 579, 342);
  c.bezierCurveTo(576, 354, 568, 353, 565, 340);
  c.lineTo(562, 323);
  c.bezierCurveTo(515, 342, 417, 339, 384, 319);
  c.bezierCurveTo(377, 327, 369, 319, 365, 299);
  c.fillStyle = caramel;
  c.fill();
  c.save();
  c.filter = 'blur(2px)';
  c.beginPath();
  c.ellipse(459, 281, 72, 12, -0.05, 0, Math.PI * 2);
  c.fillStyle = '#f2b56755';
  c.fill();
  c.restore();
  c.strokeStyle = '#fbe4b950';
  c.lineWidth = 4;
  c.beginPath();
  c.moveTo(375, 352);
  c.bezierCurveTo(367, 390, 351, 447, 347, 480);
  c.stroke();
  // A piped cream crown and a glossy cherry are part of the source image.
  c.save();
  c.shadowColor = '#4c1d142f';
  c.shadowBlur = 10;
  c.shadowOffsetY = 6;
  const cream = c.createLinearGradient(0, 190, 0, 282);
  cream.addColorStop(0, '#fffdf3');
  cream.addColorStop(1, '#e8d7b3');
  c.fillStyle = cream;
  c.beginPath();
  c.moveTo(436, 274);
  c.bezierCurveTo(414, 260, 433, 246, 443, 240);
  c.bezierCurveTo(421, 227, 454, 217, 456, 203);
  c.bezierCurveTo(459, 190, 482, 189, 481, 172);
  c.bezierCurveTo(501, 189, 490, 203, 501, 213);
  c.bezierCurveTo(530, 221, 523, 237, 513, 243);
  c.bezierCurveTo(544, 258, 525, 277, 505, 280);
  c.bezierCurveTo(482, 286, 450, 283, 436, 274);
  c.fill();
  c.restore();
  c.strokeStyle = '#d3bd9455';
  c.lineWidth = 3;
  c.beginPath();
  c.moveTo(445, 242);
  c.quadraticCurveTo(475, 250, 510, 241);
  c.moveTo(451, 219);
  c.quadraticCurveTo(478, 227, 503, 218);
  c.stroke();
  c.save();
  c.shadowColor = '#65232350';
  c.shadowBlur = 8;
  c.shadowOffsetY = 4;
  const cherry = c.createRadialGradient(489, 195, 2, 498, 205, 22);
  cherry.addColorStop(0, '#f88278');
  cherry.addColorStop(0.35, '#d84948');
  cherry.addColorStop(1, '#8c182e');
  ellipse(498, 206, 21, 20, cherry);
  c.restore();
  c.strokeStyle = '#675331';
  c.lineWidth = 3;
  c.lineCap = 'round';
  c.beginPath();
  c.moveTo(498, 189);
  c.bezierCurveTo(496, 171, 505, 157, 514, 151);
  c.stroke();
  ellipse(490, 198, 4, 3, '#ffe0cf9c');
  return canvas;
}

export const demoPoints = [
  [0.374, 0.397],
  [0.39, 0.37],
  // Cream, cherry and stem ride along with the body.
  [0.44, 0.345],
  [0.452, 0.29],
  [0.49, 0.245],
  [0.51, 0.195],
  [0.545, 0.19],
  [0.56, 0.245],
  [0.556, 0.3],
  [0.565, 0.35],
  [0.615, 0.398],
  [0.635, 0.51],
  [0.67, 0.683],
  [0.638, 0.722],
  [0.55, 0.746],
  [0.43, 0.744],
  [0.347, 0.715],
  [0.329, 0.679],
  [0.357, 0.5],
];
