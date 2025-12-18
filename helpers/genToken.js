import jwt from "jsonwebtoken";
const generarJwt = (id) => {
  return jwt.sign(
    { id },
    process.env.APP_PRIVATEKEY,
    { expiresIn: '1d' }
  );
};


const generarId = () => Math.random().toString(32).substring(2)+Date.now().toString(32);




export {
    generarId, generarJwt
}