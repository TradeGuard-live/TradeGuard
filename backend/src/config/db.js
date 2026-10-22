import mongoose from "mongoose";

export const connectDB = async () => {
    try {
        console.log(process.env.MONGO_URI);
        await mongoose.connect(process.env.MONGO_URI);

        console.log("MongoDB Connected");

    } catch (error) {

        console.error(
            "Error connecting to MongoDB:",
            error.message
        );

        throw error;
    }
};