import mongoose, { Schema, Document } from 'mongoose';

export interface IProcessedMessage extends Document {
  idMessage: string;
  createdAt: Date;
}

const ProcessedMessageSchema: Schema = new Schema(
  {
    idMessage: { type: String, required: true, unique: true },
  },
  { timestamps: true }
);

// TTL: auto-delete after 24 hours to prevent unbounded growth
ProcessedMessageSchema.index({ createdAt: 1 }, { expireAfterSeconds: 86400 });

if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.ProcessedMessage;
}

export default mongoose.models.ProcessedMessage || mongoose.model<IProcessedMessage>('ProcessedMessage', ProcessedMessageSchema);
