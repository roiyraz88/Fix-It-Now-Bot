import mongoose, { Schema, Document } from 'mongoose';

export interface IConversationState extends Document {
  phone: string;
  state: string;
  lastJobId?: mongoose.Types.ObjectId;
  chatHistory: { role: 'user' | 'assistant', content: string }[];
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
      explanation: string;
    };
  };
}

const ConversationStateSchema: Schema = new Schema({
  phone: { type: String, required: true, unique: true },
  state: { 
    type: String, 
    default: 'welcome'
  },
  lastJobId: { type: Schema.Types.ObjectId, ref: 'Job' },
  chatHistory: [
    {
      role: { type: String, enum: ['user', 'assistant'] },
      content: { type: String }
    }
  ],
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
