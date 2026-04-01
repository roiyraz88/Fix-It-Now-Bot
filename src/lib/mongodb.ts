import mongoose from 'mongoose';
import { MONGODB_URI } from './green-api';

if (!MONGODB_URI) {
  throw new Error('Please define the MONGODB_URI environment variable (e.g. in Vercel → Settings → Environment Variables)');
}

/**
 * Global is used here to maintain a cached connection across hot reloads
 * in development. This prevents connections growing exponentially
 * during API Route usage.
 *
 * Vercel + MongoDB Atlas: Atlas → Network Access must allow your app’s source IPs.
 * For serverless, add `0.0.0.0/0` (“Allow access from anywhere”) or Atlas’s
 * equivalent, otherwise you get MongooseServerSelectionError / IP whitelist errors.
 * @see https://www.mongodb.com/docs/atlas/setup-cluster-security/#ip-access-list
 */
let cached = (global as any).mongoose;

if (!cached) {
  cached = (global as any).mongoose = { conn: null, promise: null };
}

async function dbConnect() {
  if (cached.conn) {
    return cached.conn;
  }

  if (!cached.promise) {
    const opts = {
      bufferCommands: false,
      // Suited to short-lived serverless invocations (e.g. Vercel)
      maxPoolSize: 10,
      minPoolSize: 0,
      serverSelectionTimeoutMS: 15_000,
      socketTimeoutMS: 45_000,
      // Some cloud egress paths break IPv6 to Atlas; IPv4 is more reliable
      family: 4 as const,
    };

    cached.promise = mongoose.connect(MONGODB_URI, opts).then((mongoose) => {
      return mongoose;
    });
  }

  try {
    cached.conn = await cached.promise;
  } catch (e) {
    cached.promise = null;
    cached.conn = null;
    throw e;
  }

  return cached.conn;
}

export default dbConnect;

