import mongoose, { Schema, Document } from 'mongoose';

export interface IProfessional extends Document {
  name: string;
  phone: string;
  profession: 'plumber' | 'electrician' | 'ac';
  city: string;
  experienceYears: number;
  verified: boolean;
  description: string;
  aboutMe: string;
  documents: {
    selfieUrl?: string;
    idUrl?: string;
    certificateUrl?: string;
  };
}

const ProfessionalSchema: Schema = new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  profession: { type: String, enum: ['plumber', 'electrician', 'ac'], required: true },
  city: { type: String, required: true },
  experienceYears: { type: Number, required: true },
  verified: { type: Boolean, default: false },
  description: { type: String },
  documents: {
    selfieUrl: { type: String },
    idUrl: { type: String },
    certificateUrl: { type: String },
  },
}, { timestamps: true });

// Delete the model if it exists to force schema update in development
if (process.env.NODE_ENV === 'development') {
  delete mongoose.models.Professional;
}

export default mongoose.models.Professional || mongoose.model<IProfessional>('Professional', ProfessionalSchema);

