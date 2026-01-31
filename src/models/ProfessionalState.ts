import mongoose, { Schema, Document } from 'mongoose';

export interface IProfessionalState extends Document {
  phone: string;
  currentJobId?: mongoose.Types.ObjectId;
  step: 'idle' | 'awaiting_price' | 'awaiting_eta';
  pendingJobIds: mongoose.Types.ObjectId[];
  accumulatedOffer: {
    price?: number;
    eta?: string;
  };
}

const ProfessionalStateSchema: Schema = new Schema({
  phone: { type: String, required: true, unique: true },
  currentJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  step: { 
    type: String, 
    enum: ['idle', 'awaiting_price', 'awaiting_eta'],
    default: 'idle'
  },
  pendingJobIds: [{ type: Schema.Types.ObjectId, ref: 'Job' }],
  accumulatedOffer: {
    price: { type: Number },
    eta: { type: String },
  },
}, { timestamps: true });

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.ProfessionalState;
}

export default mongoose.models.ProfessionalState || mongoose.model<IProfessionalState>('ProfessionalState', ProfessionalStateSchema);

