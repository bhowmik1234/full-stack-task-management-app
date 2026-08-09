import { createSlice, PayloadAction } from "@reduxjs/toolkit";
import { User } from "../types/types";
import { Permission } from "./permissions";
import type { SessionPayload } from "./types";

/**
 * Who is signed into the console, and what they may do.
 *
 * Five states, not two, because each needs a different thing said to the
 * person in front of it:
 *
 *   loading        — Firebase has not reported yet; render nothing.
 *   anonymous      — no provider session. Show the sign-in form.
 *   forbidden      — signed in, but the account has no console access. Sending
 *                    them back to a sign-in form they already completed would
 *                    change nothing, so they are told instead.
 *   suspended      — had access, it is paused. A different sentence and a
 *                    different remedy from "you were never staff".
 *   rejected       — the provider session exists but the server refused it:
 *                    wrong sign-in method, session too old, second factor
 *                    missing. Signing out and back in with the same method
 *                    would loop, so the server's own message is shown.
 *   authenticated  — in, with `permissions` deciding what they see.
 *
 * `permissions` is whatever the server said on the last session load and is
 * never computed here. It gates rendering only: every endpoint re-checks, so a
 * tampered store buys a broken-looking page and nothing else.
 */
type Status =
  | "loading"
  | "authenticated"
  | "anonymous"
  | "forbidden"
  | "suspended"
  | "rejected";

type SessionState = {
  status: Status;
  user: User | null;
  permissions: Permission[];
  isRoot: boolean;
  /** Why the session was refused. Only set with status "rejected". */
  message: string | null;
};

const initialState: SessionState = {
  status: "loading",
  user: null,
  permissions: [],
  isRoot: false,
  message: null,
};

export const sessionSlice = createSlice({
  name: "session",
  initialState,
  reducers: {
    /** The one action the bootstrap dispatches; the server decided the shape. */
    sessionLoaded: (state, action: PayloadAction<SessionPayload>) => {
      const { user, staff } = action.payload;
      state.user = user;
      state.message = null;

      if (!staff) {
        state.status = "forbidden";
        state.permissions = [];
        state.isRoot = false;
        return;
      }

      state.status = staff.status === "suspended" ? "suspended" : "authenticated";
      // The server already sends [] for a suspended operator; mirroring that
      // here means no component has to remember to check the status as well.
      state.permissions = staff.status === "suspended" ? [] : staff.permissions;
      state.isRoot = staff.isRoot;
    },
    /**
     * The provider signed them in and the server said no. Distinct from
     * `signedOut` because there is a reason to show, and from `forbidden`
     * because the account may well have access — it is the *sign-in* that was
     * refused, so trying again the same way changes nothing.
     */
    sessionRejected: (state, action: PayloadAction<string>) => {
      state.status = "rejected";
      state.message = action.payload;
      state.permissions = [];
      state.isRoot = false;
    },
    signedOut: (state) => {
      state.user = null;
      state.status = "anonymous";
      state.permissions = [];
      state.isRoot = false;
      state.message = null;
    },
  },
});

export const { sessionLoaded, sessionRejected, signedOut } = sessionSlice.actions;
