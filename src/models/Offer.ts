import mongoose, { Schema, Document } from 'mongoose';

export interface IOffer extends Document {
  jobId: mongoose.Types.ObjectId;
  professionalPhone: string;
  price: number;
  eta: string;
}

const OfferSchema: Schema = new Schema({
  jobId: { type: Schema.Types.ObjectId, ref: 'Job', required: true },
  professionalPhone: { type: String, required: true },
  price: { type: Number, required: true },
  eta: { type: String, required: true },
}, { timestamps: true });

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.Offer;
}

export default mongoose.models.Offer || mongoose.model<IOffer>('Offer', OfferSchema);

