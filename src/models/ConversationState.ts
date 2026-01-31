import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationState extends Document {
  phone: string;
  state: 'welcome' | 'waiting_for_details' | 'waiting_for_photo' | 'waiting_for_city' | 'searching_professionals' | 'waiting_for_offers' | 'offers_ready';
  lastJobId?: mongoose.Types.ObjectId;
  accumulatedData: {
    initialProblem?: string;
    detailedDescription?: string;
    description?: string;
    problemType?: string;
    city?: string;
    urgency?: string;
    photoUrl?: string;
    priceEstimation?: {
      min: number;
      max: number;
    };
  };
}

const ConversationStateSchema: Schema = new Schema({
  phone: { type: String, required: true, unique: true },
  state: { 
    type: String, 
    enum: ['welcome', 'waiting_for_details', 'collecting_info', 'waiting_for_photo', 'waiting_for_city', 'searching_professionals', 'waiting_for_offers', 'offers_ready'],
    default: 'welcome'
  },
  lastJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  accumulatedData: {
    initialProblem: { type: String },
    detailedDescription: { type: String },
    description: { type: String },
    problemType: { type: String },
    city: { type: String },
    urgency: { type: String },
    photoUrl: { type: String },
    priceEstimation: {
      min: { type: Number },
      max: { type: Number },
      explanation: { type: String }
    },
  },
}, { timestamps: true });

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.ConversationState;
}

export default mongoose.models.ConversationState || mongoose.model<IConversationState>('ConversationState', ConversationStateSchema);
