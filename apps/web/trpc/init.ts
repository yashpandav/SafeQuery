import { initTRPC } from '@trpc/server';

export const createTRPCContext = async (opts: { headers: Headers }) => {
    // const user = await auth(opts.headers);
    return { userId: 'user_123' };
};

const t = initTRPC
    .context<Awaited<ReturnType<typeof createTRPCContext>>>()
    .create({
        /**
         * @see https://trpc.io/docs/server/data-transformers
         */
        // transformer: superjson,
    });

export const createTRPCRouter: typeof t.router = t.router;
export const createCallerFactory: typeof t.createCallerFactory = t.createCallerFactory;
export const baseProcedure: typeof t.procedure = t.procedure;