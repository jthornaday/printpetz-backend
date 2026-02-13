import { getUser } from "@/services/user_service";
import supabase from "@/supabase/create_client";
import errorResponse from "@/utils/errors/errorResponse";

/**
 * Verify the token from the request headers
 * @param req - The request object
 * @param res - The response object
 * @param next - The next middleware function
 * @returns The result of the verification
 */
export const verifyToken = async (req, res, next) => {
  try {
    let supabaseAuthToken: string | null = null;
    let userId: string | null = null;

    if (
      req.headers.authorization &&
      req.headers.authorization.startsWith("Bearer")
    ) {
      supabaseAuthToken = req.headers.authorization.split(" ")[1];
    }

    if (
      !supabaseAuthToken &&
      !req.headers["user-id"] &&
      !req.baseUrl.includes("/public")
    ) {
      throw errorResponse.Api400Error({
        errorDescription: "please provide authorization token in header",
      });
    }

    if (supabaseAuthToken) {
      const userResponse = await supabase.auth.getUser(supabaseAuthToken);

      if (userResponse.error) {
        throw errorResponse.Api401Error({
          errorDescription: userResponse.error.message,
        });
      }

      userId = userResponse.data?.user.id as string;
    }

    if (req.headers["user-id"] && !userId) {
      userId = req.headers["user-id"];
    }

    const supabaseUser = await getUser(userId);
    if (!supabaseUser) {
      throw errorResponse.Api404Error({
        errorDescription: "user not found",
      });
    }
    req.user = supabaseUser;

    next();
  } catch (error) {
    next(error);
  }
};
