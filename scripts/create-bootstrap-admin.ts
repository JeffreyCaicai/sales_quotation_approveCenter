import { eq } from "drizzle-orm";

import { closeDb, getDb } from "../db/index";
import { userPermissions, users } from "../db/schema";
import {
  hashPassword,
  normalizeEmail,
} from "../lib/auth/password";
import { permissions } from "../lib/auth/permissions";

async function main(): Promise<void> {
  const email = normalizeEmail(process.env.BOOTSTRAP_ADMIN_EMAIL ?? "");
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD ?? "";
  const passwordHash = await hashPassword(password);
  const db = getDb();

  await db.transaction(async (tx) => {
    const [user] = await tx
      .insert(users)
      .values({
        email,
        passwordHash,
        displayName: "Bootstrap Admin",
        status: "active",
      })
      .onConflictDoUpdate({
        target: users.email,
        set: {
          passwordHash,
          displayName: "Bootstrap Admin",
          status: "active",
          updatedAt: new Date(),
        },
      })
      .returning({ id: users.id });

    await tx.delete(userPermissions).where(eq(userPermissions.userId, user.id));
    await tx.insert(userPermissions).values(
      permissions.map((permissionKey) => ({
        userId: user.id,
        permissionKey,
      })),
    );
  });

  console.log(`Bootstrap administrator ready: ${email}`);
}

main()
  .catch(() => {
    console.error("Failed to create bootstrap administrator.");
    process.exitCode = 1;
  })
  .finally(closeDb);
