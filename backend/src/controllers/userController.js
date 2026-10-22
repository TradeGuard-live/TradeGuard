import User from "../models/User.js";
import BrokerAccount from "../models/BrokerAccount.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import dotenv from "dotenv";
import transporter from "../utils/transporter.js";
import { verifyBrokerCredentials } from "./brokerAccountController.js";

dotenv.config();

export async function login(req, res) {
    try {
        const { email, password } = req.body;

        const user = await User.findOne({ email });

        if (!user) {
            return res.status(404).json({ message: "User not found" });
        }

        const isPasswordCorrect = await bcrypt.compare(password, user.password);

        if (!isPasswordCorrect) return res.status(400).json({ message: "Invalid credentials" });

        const token = jwt.sign(
            { userId: user._id, email: user.email },
            process.env.JWT_SECRET,
            { expiresIn: "1d" }
        );

        // Check and verify user's broker account tokens live upon login
        let verifiedBrokerAccounts = [];
        try {
            const accounts = await BrokerAccount.find({ userId: user._id });
            await Promise.all(
                accounts.map(acc => verifyBrokerCredentials(acc).catch(() => false))
            );
            verifiedBrokerAccounts = accounts.map(acc => ({
                id: acc._id,
                broker: acc.broker,
                isConnected: acc.isConnected,
                lastConnectedAt: acc.lastConnectedAt
            }));
        } catch (e) {
            console.warn("Broker verification on login warning:", e.message);
        }

        res.status(200).json({
            token,
            user: { id: user._id, userId: user._id, username: user.username, email: user.email },
            brokerAccounts: verifiedBrokerAccounts
        });
    }
    catch (error) {
        console.log("Error to get all User", error);
        res.status(500).json({ message: "Internal Server Error" });
    }
}



export async function forgotPassword(req,res) {
    
    try{
        const {email} = req.body
        
        const existingUser = await User.findOne({email});

        console.log(existingUser)


      
      console.log("User found")
      console.log(process.env.EMAIL_USER)
       console.log(process.env.RESET_URL)

       const token = jwt.sign(
         {userId : existingUser._id , email : existingUser.email},
         process.env.JWT_SECRET,
         {expiresIn : "15m"}
     )
      const resetLink = `${process.env.RESET_URL}/${token}`;

       console.log("Reset link generated:", resetLink); // Log the reset link for debugging

       await transporter.sendMail({
        from: process.env.EMAIL_USER,
        to: email,       // ← FROM DATABASE
        subject: "Reset your password",
        html: `
           <h2>Password Reset</h2>
           <p>Hello ${existingUser.username},</p>
           <p>Click the link below to reset your password.</p>
           <p>Your Reset Link is : ${resetLink}</p>
           <p>This link expires in 15 minutes.</p>
     `
        });

        
        return res.status(200).json({message: "If the account exists, a reset email has been sent." , token : "token"});
      

    }catch(error){
        console.log(error.errors)
        res.status(500).json({message : "Server Error occured"});
    }
     
}


export async function register(req,res) {
   
    try{
        
        const {username,email,password} = req.body
        
        const existingUser = await User.findOne({email});
        
        if(existingUser){
            return res.status(400).json({message : "User already exists"})
        }
        
        const lastUser = await User.findOne().sort({ userId: -1 });

         const nextUserId = lastUser && Number.isFinite(lastUser.userId)
        ? lastUser.userId + 1
        : 1;
        const newUser = new User({userId: nextUserId, username, email, password});
        
        await newUser.save();
             
        const token = jwt.sign(
         {userId : newUser._id , email : newUser.email},
         process.env.JWT_SECRET,
         {expiresIn : "1d"}
     )
    console.log("Everythong is fine, token generated:", token); // Log the generated token for debugging
         
        res.status(201).json({token, user: {id: newUser._id, username: newUser.username, email: newUser.email}});

    }catch(error){
        console.log(error)
        res.status(500).json({message : "User not created"});
    }
    
}


export async function resetPassword(req, res) {
    try {
        const { token, newPassword } = req.body;

        console.log("Received token:", token);
        console.log("Received password:", newPassword);

        const decoded = jwt.verify(
            token,
            process.env.JWT_SECRET
        );

        console.log("Decoded token:", decoded);

        const user = await User.findById(decoded.userId);

        if (!user) {
            return res.status(404).json({
                message: "User not found"
            });
        }

        user.password = newPassword

        await user.save();
        const isPasswordCorrect = await bcrypt.compare(newPassword , user.password)
        console.log("Password reset successful : ",isPasswordCorrect);
        
        return res.status(200).json({
            message: "Password reset successfully"
        });

    } catch (error) {
        console.log("JWT/RESET ERROR:", error);
        console.log("ERROR MESSAGE:", error.message);

        return res.status(500).json({
            message: "Password reset failed"
        });
    }
}
