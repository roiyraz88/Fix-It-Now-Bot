import mongoose, { Schema, Document } from 'mongoose';

export interface ICounter extends Document {
  id: string;
  seq: number;
}

const CounterSchema: Schema = new Schema({
  id: { type: String, required: true },
  seq: { type: Number, default: 0 }
});

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.Counter;
}

export default mongoose.models.Counter || mongoose.model<ICounter>('Counter', CounterSchema);

