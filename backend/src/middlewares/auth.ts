import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { TryCatch } from "./error.js";


export const adminOnly = TryCatch(async(req, res, next)=>{
    const { id } = req.query;

    if(!id) return next(new ErrorHandler("Please Login first", 401));
    const user = await prisma.user.findUnique({ where: { id: String(id) } });
    if(!user) return next(new ErrorHandler("Invalid Id ", 401));
    if(user.role != "admin") return next(new ErrorHandler("Only admin can access", 401));

    next();
})

export const verifyUser = TryCatch(async(req, res, next)=>{
    const { id } = req.query;

    if(!id) return next(new ErrorHandler("Please Login first", 401));
    const user = await prisma.user.findUnique({ where: { id: String(id) } });
    if(!user) return next(new ErrorHandler("Invalid Id ", 401));

    next();
})
