import "server-only";
import { betterAuth } from "better-auth";
import { prismaAdapter } from "better-auth/adapters/prisma";
import { nextCookies } from "better-auth/next-js";
import { admin } from "better-auth/plugins";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { logger } from "@/lib/logger";
import { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";

// Better Auth gère les sessions, le hachage des mots de passe et les cookies : on ne code pas
// de cryptographie maison (CDC A.9). Les comptes sont créés UNIQUEMENT par un administrateur.
export const auth = betterAuth({
  baseURL: env.BETTER_AUTH_URL,
  secret: env.BETTER_AUTH_SECRET,
  database: prismaAdapter(db, { provider: "postgresql" }),

  emailAndPassword: {
    enabled: true,
    disableSignUp: true,
    minPasswordLength: PASSWORD_MIN_LENGTH,
    maxPasswordLength: PASSWORD_MAX_LENGTH,
    autoSignIn: false,
    // Un changement ou une réinitialisation de mot de passe déconnecte les autres appareils.
    revokeSessionsOnPasswordReset: true,
  },

  user: {
    additionalFields: {
      mustChangePassword: { type: "boolean", required: false, defaultValue: false, input: false },
      teamId: { type: "string", required: false, input: false },
    },
  },

  session: {
    expiresIn: 60 * 60 * 12, // 12 h ; sans « Se souvenir de moi », la session s'arrête à la fermeture du navigateur
    updateAge: 60 * 60,
  },

  rateLimit: {
    enabled: true,
    window: 60,
    max: 100,
    customRules: {
      "/sign-in/email": { window: 60, max: 5 },
    },
  },

  // Un seul chemin de connexion : l'action serveur de la page /login, qui limite le débit et audite les échecs.
  // disabledPaths ne ferme que l'accès HTTP ; auth.api.signInEmail reste utilisable côté serveur.
  disabledPaths: ["/sign-in/email"],

  advanced: {
    useSecureCookies: env.NODE_ENV === "production",
    database: { generateId: "uuid" },
    ipAddress: { ipAddressHeaders: ["x-forwarded-for"] },
  },

  databaseHooks: {
    session: {
      create: {
        after: async (session) => {
          try {
            await db.user.update({ where: { id: session.userId }, data: { lastLoginAt: new Date() } });
            await db.auditLog.create({
              data: {
                actorUserId: session.userId,
                action: "auth.login",
                entityType: "user",
                entityId: session.userId,
                ipAddress: session.ipAddress ?? null,
              },
            });
          } catch (error) {
            // Une connexion réussie ne doit pas échouer à cause de la trace, mais l'incident est signalé.
            logger.error({ err: error }, "Échec de l'écriture de la trace de connexion");
          }
        },
      },
    },
  },

  // nextCookies doit rester le DERNIER plugin : il permet de poser les cookies depuis les Server Actions.
  plugins: [admin({ defaultRole: "commercial", adminRoles: ["admin"] }), nextCookies()],
});

export type AuthSession = typeof auth.$Infer.Session;
