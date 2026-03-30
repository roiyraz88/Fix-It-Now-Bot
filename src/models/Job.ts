import mongoose, { Schema, Document } from 'mongoose';

export interface IJob extends Document {
  shortId: number;
  clientPhone: string;
  description: string;
  detailedDescription?: string;
  problemType: 'plumber' | 'electrician' | 'ac' | 'painter' | 'handyman' | 'contractor' | 'other' | null;
  city: string | null;
  urgency: 'low' | 'medium' | 'high' | null;
  photoUrl?: string;
  status: 'collecting_info' | 'searching_professionals' | 'waiting_for_offers' | 'offers_ready' | 'assigned' | 'completed' | 'cancelled';
  assignedProfessionalPhone?: string;
  /** First time pros were notified (for one-time ~30min client follow-up) */
  firstProsNotifiedAt?: Date;
  /** Client received the "need more offers?" question */
  clientFollowUpSent?: boolean;
  /** If false, client said they don't need more – block sharing contact */
  acceptingMorePros?: boolean;
}

const JobSchema: Schema = new Schema({
  shortId: { type: Number, unique: true },
  clientPhone: { type: String, required: true },
  description: { type: String, required: true },
  detailedDescription: { type: String },
  problemType: { type: String, enum: ['plumber', 'electrician', 'ac', 'painter', 'handyman', 'contractor', 'other', null], default: null },
  city: { type: String, default: null },
  urgency: { type: String, enum: ['low', 'medium', 'high', null], default: null },
  photoUrl: { type: String },
  status: { 
    type: String, 
    enum: ['collecting_info', 'searching_professionals', 'waiting_for_offers', 'offers_ready', 'assigned', 'completed', 'cancelled'],
    default: 'collecting_info'
  },
  assignedProfessionalPhone: { type: String },
  firstProsNotifiedAt: { type: Date },
  clientFollowUpSent: { type: Boolean, default: false },
  acceptingMorePros: { type: Boolean, default: true },
}, { timestamps: true });

export default mongoose.models.Job || mongoose.model<IJob>('Job', JobSchema);

