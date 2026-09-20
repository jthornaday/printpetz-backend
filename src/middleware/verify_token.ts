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
    const authorization = req.headers.authorization;

    if (!authorization || !authorization.startsWith("Bearer ")) {
      throw errorResponse.Api401Error({
        errorDescription: "please provide authorization token in header",
      });
    }

    const supabaseAuthToken = authorization.split(" ")[1];
    const userResponse = await supabase.auth.getUser(supabaseAuthToken);

    if (userResponse.error || !userResponse.data?.user) {
      throw errorResponse.Api401Error({
        errorDescription:
          userResponse.error?.message ?? "invalid authorization token",
      });
    }

    const userId = userResponse.data.user.id;

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
