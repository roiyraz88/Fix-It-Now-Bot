import mongoose, { Schema, Document } from 'mongoose';

export interface IJob extends Document {
  shortId: number;
  clientPhone: string;
  description: string;
  detailedDescription?: string;
  problemType: 'plumber' | 'electrician' | 'ac' | null;
  city: string | null;
  urgency: 'low' | 'medium' | 'high' | null;
  photoUrl?: string;
  status: 'collecting_info' | 'searching_professionals' | 'waiting_for_offers' | 'offers_ready' | 'assigned' | 'completed' | 'cancelled';
  assignedProfessionalPhone?: string;
}

const JobSchema: Schema = new Schema({
  shortId: { type: Number, unique: true },
  clientPhone: { type: String, required: true },
  description: { type: String, required: true },
  detailedDescription: { type: String },
  problemType: { type: String, enum: ['plumber', 'electrician', 'ac', null], default: null },
  city: { type: String, default: null },
  urgency: { type: String, enum: ['low', 'medium', 'high', null], default: null },
  photoUrl: { type: String },
  status: { 
    type: String, 
    enum: ['collecting_info', 'searching_professionals', 'waiting_for_offers', 'offers_ready', 'assigned', 'completed', 'cancelled'],
    default: 'collecting_info'
  },
  assignedProfessionalPhone: { type: String },
}, { timestamps: true });

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.Job;
}

export default mongoose.models.Job || mongoose.model<IJob>('Job', JobSchema);

