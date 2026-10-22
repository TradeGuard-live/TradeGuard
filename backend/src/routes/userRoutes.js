import express from 'express';
import { register, login,forgotPassword , resetPassword }
from '../controllers/userController.js';


const router = express.Router();

router.post("/" ,login);
router.post("/register" ,register);
// router.post("/logout" ,logout);
// router.put("/update" ,protected,updateProfile);
router.post("/forgot-password",forgotPassword);
router.post("/reset-password",resetPassword);
// router.delete("/deleteuser" ,protected,deleteUser);

export default router;  