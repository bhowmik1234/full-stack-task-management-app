import mongoose from "mongoose"

export const connectdb =  ()=>{
    mongoose.connect(process.env.MONGO_URI!,{
        dbName: "Ecommerce_24"
    })
    .then((c)=>{console.log(`Database connected, ${c.connection.host}`)})
    .catch((e)=>{console.log(e)});
}
// yncM3DCSeOYtbdUg