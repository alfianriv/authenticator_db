const jsQR = require("jsqr");
const { Jimp } = require("jimp");

async function decompileQrCodeFromBuffer(imageBuffer) {
  try {
    const image = await Jimp.read(imageBuffer);

    const imageData = {
      data: new Uint8ClampedArray(image.bitmap.data),
      width: image.bitmap.width,
      height: image.bitmap.height,
    };

    const decodedQR = jsQR(imageData.data, imageData.width, imageData.height);

    if (!decodedQR) {
      throw new Error("QR code not found in the image.");
    }

    return decodedQR.data;
  } catch (error) {
    console.error("Error decompiling QR code:", error);
    throw error;
  }
}

module.exports = {
  decompileQrCodeFromBuffer,
};
