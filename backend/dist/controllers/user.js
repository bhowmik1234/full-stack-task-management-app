import { prisma } from "../utils/db.js";
import ErrorHandler from "../utils/utiliy-class.js";
import { TryCatch } from "../middlewares/error.js";
import { serializeUser, serializeUsers } from "../utils/serialize.js";
export const newUser = TryCatch(async (req, res, next) => {
    const { name, email, gender, _id, photo, dob } = req.body;
    if (_id) {
        const existing = await prisma.user.findUnique({ where: { id: _id } });
        if (existing) {
            return res.status(200).json({
                success: true,
                message: `welcome ${existing.name}`,
            });
        }
    }
    if (!_id || !name || !email || !gender || !photo || !dob) {
        return next(new ErrorHandler("Please provide all the details", 400));
    }
    if (gender !== "Male" && gender !== "Female")
        return next(new ErrorHandler("Gender must be Male or Female", 400));
    const user = await prisma.user.create({
        data: {
            id: _id,
            name,
            email,
            gender: gender,
            photo,
            dob: new Date(dob),
        },
    });
    return res.status(200).json({
        success: true,
        message: `welcome ${user.name}`,
    });
});
export const getallUsers = TryCatch(async (req, res, next) => {
    const users = await prisma.user.findMany();
    return res.status(200).json({
        success: true,
        users: serializeUsers(users)
    });
});
export const getUser = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user) {
        return next(new ErrorHandler("Invalid Id", 400));
    }
    return res.status(200).json({
        success: true,
        user: serializeUser(user)
    });
});
export const deleteUser = TryCatch(async (req, res, next) => {
    const id = String(req.params.id);
    const user = await prisma.user.findUnique({ where: { id } });
    if (!user)
        return next(new ErrorHandler("Invalid Id", 400));
    // orders reference the user, so deleting one with order history would
    // violate the FK; report that rather than 500ing
    const orderCount = await prisma.order.count({ where: { userId: id } });
    if (orderCount > 0)
        return next(new ErrorHandler("Cannot delete a user who has placed orders", 400));
    await prisma.user.delete({ where: { id } });
    return res.status(200).json({
        success: true,
        message: "User deleted successfully"
    });
});
