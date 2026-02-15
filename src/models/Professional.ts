import mongoose, { Schema, Document } from 'mongoose';

export interface IProfessional extends Document {
  name: string;
  phone: string;
  profession: 'plumber' | 'electrician' | 'ac' | 'painter' | 'handyman' | 'contractor';
  city: string;
  experienceYears: number;
  verified: boolean;
  description: string;
  aboutMe: string;
  profilePhotoUrl?: string;
  documents: {
    selfieUrl?: string;
    idUrl?: string;
    certificateUrl?: string;
  };
}

const ProfessionalSchema: Schema = new Schema({
  name: { type: String, required: true },
  phone: { type: String, required: true, unique: true },
  profession: { type: String, enum: ['plumber', 'electrician', 'ac', 'painter', 'handyman', 'contractor'], required: true },
  city: { type: String, required: true },
  experienceYears: { type: Number, required: true },
  verified: { type: Boolean, default: false },
  description: { type: String },
  aboutMe: { type: String },
  profilePhotoUrl: { type: String },
  documents: {
    selfieUrl: { type: String },
    idUrl: { type: String },
    certificateUrl: { type: String },
  },
}, { timestamps: true });

export default mongoose.models.Professional || mongoose.model<IProfessional>('Professional', ProfessionalSchema);

