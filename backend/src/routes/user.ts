import express from 'express';
import {
  closeMyAccount,
  deleteUser,
  getUser,
  getallUsers,
  newUser,
  syncIdentity,
  unsubscribeEmails,
  updateEmailPreferences,
  updateUser,
} from '../controllers/user.js';
import { requirePermission, requireSelf, selfOrAdmin, verifyUser } from '../middlewares/auth.js';
import { adminLimiter, sensitiveLimiter, writeLimiter } from '../middlewares/rateLimit.js';

const router = express.Router();

// route ~ /api/v1/user/new
router.post('/new', writeLimiter, newUser);

// route ~ /api/v1/user/all
router.get('/all', adminLimiter, requirePermission('customers_read'), getallUsers);

// route ~ /api/v1/user/me
// Closing an account is the caller's own decision about their own row, so it
// takes no id from the path at all. Registered above "/:id" so the literal
// segment wins.
router.delete('/me', verifyUser, sensitiveLimiter, closeMyAccount);

// route ~ /api/v1/user/unsubscribe
// Deliberately unauthenticated: the caller is reading an email, not signed in.
// Authority comes from the HMAC in the token instead (utils/unsubscribe.ts),
// exactly as the Razorpay webhook is authenticated by a signature rather than a
// uid. Registered above "/:id" so the literal segment wins.
router.get('/unsubscribe', sensitiveLimiter, unsubscribeEmails);

// route ~ /api/v1/user/me/email-preferences
// The signed-in equivalent of the link above, for the settings page.
router.put('/me/email-preferences', verifyUser, writeLimiter, updateEmailPreferences);

// route ~ /api/v1/user/{dynamic id}
// selfOrAdmin on GET: this returns email, dob and role, so it must not be
// readable by anyone who merely knows a Firebase uid.
//
// requireSelf on PUT: deliberately stricter than the GET. `customers_read` is
// the right escape hatch for looking at a customer record and the wrong one for
// rewriting it, and editing somebody's own profile is not an operator task.
router
  .route('/:id')
  .get(selfOrAdmin(), getUser)
  .put(requireSelf(), writeLimiter, updateUser)
  .delete(adminLimiter, requirePermission('customers_write'), writeLimiter, deleteUser);

// route ~ /api/v1/user/:id/identity
// Called after the client links a second sign-in method. Reads the identifiers
// back from Firebase rather than from the body — see the controller.
router.put('/:id/identity', requireSelf(), sensitiveLimiter, syncIdentity);


export default router;
