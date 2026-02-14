'use client';

import { useState, useEffect, useRef } from 'react';

const getProfessionName = (profession: string): string => {
  const names: Record<string, string> = {
    plumber: 'אינסטלטור',
    electrician: 'חשמלאי',
    ac: 'טכנאי מיזוג',
    painter: 'צבעי',
    handyman: 'הנדימן',
    contractor: 'קבלן שיפוצים'
  };
  return names[profession] || profession;
};

export default function ProfessionalsAdmin() {
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [formData, setFormData] = useState({
    name: '',
    phone: '',
    profession: 'plumber',
    city: '',
    experienceYears: 1,
    aboutMe: '',
    profilePhotoUrl: '',
    verified: true
  });

  useEffect(() => {
    fetchProfessionals();
  }, []);

  const fetchProfessionals = async () => {
    try {
      const res = await fetch('/api/professionals');
      const data = await res.json();
      setProfessionals(data);
    } catch (err) {
      console.error('Failed to fetch:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      alert('נא להעלות קובץ תמונה בלבד');
      return;
    }

    if (file.size > 5 * 1024 * 1024) {
      alert('גודל הקובץ המקסימלי הוא 5MB');
      return;
    }

    setUploading(true);
    try {
      const uploadData = new FormData();
      uploadData.append('file', file);

      const res = await fetch('/api/upload', {
        method: 'POST',
        body: uploadData,
      });

      if (res.ok) {
        const data = await res.json();
        setFormData({ ...formData, profilePhotoUrl: data.url });
      } else {
        const error = await res.json();
        alert('שגיאה בהעלאה: ' + (error.error || 'Unknown error'));
      }
    } catch (err) {
      alert('שגיאה בהעלאת התמונה');
      console.error(err);
    } finally {
      setUploading(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      const res = await fetch('/api/professionals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(formData),
      });
      if (res.ok) {
        setFormData({
          name: '',
          phone: '',
          profession: 'plumber',
          city: '',
          experienceYears: 1,
          aboutMe: '',
          profilePhotoUrl: '',
          verified: true
        });
        if (fileInputRef.current) {
          fileInputRef.current.value = '';
        }
        fetchProfessionals();
      } else {
        const data = await res.json();
        alert(data.error || 'Failed to add professional');
      }
    } catch (err) {
      alert('Error adding professional');
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Are you sure?')) return;
    try {
      await fetch(`/api/professionals?id=${id}`, { method: 'DELETE' });
      fetchProfessionals();
    } catch (err) {
      alert('Error deleting');
    }
  };

  return (
    <div className="min-h-screen bg-gray-50 p-8 text-gray-900">
      <div className="max-w-6xl mx-auto">
        <h1 className="text-3xl font-bold mb-8 text-green-700">ניהול בעלי מקצוע - FixItNow</h1>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="bg-white p-6 rounded-xl shadow-md border border-gray-200 h-fit">
            <h2 className="text-xl font-bold mb-4">הוספת בעל מקצוע חדש</h2>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div>
                <label className="block text-sm font-medium">שם מלא</label>
                <input
                  type="text"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">טלפון (ללא 0, למשל 97255...)</label>
                <input
                  type="text"
                  value={formData.phone}
                  onChange={(e) => setFormData({ ...formData, phone: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">מקצוע</label>
                <select
                  value={formData.profession}
                  onChange={(e) => setFormData({ ...formData, profession: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                >
                  <option value="plumber">אינסטלטור</option>
                  <option value="electrician">חשמלאי</option>
                  <option value="ac">טכנאי מיזוג</option>
                  <option value="painter">צבעי</option>
                  <option value="handyman">הנדימן</option>
                  <option value="contractor">קבלן שיפוצים</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium">עיר</label>
                <input
                  type="text"
                  value={formData.city}
                  onChange={(e) => setFormData({ ...formData, city: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">שנות ניסיון</label>
                <input
                  type="number"
                  value={formData.experienceYears}
                  onChange={(e) => setFormData({ ...formData, experienceYears: parseInt(e.target.value) })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                  required
                />
              </div>
              <div>
                <label className="block text-sm font-medium">קצת עלי (יופיע ללקוח)</label>
                <textarea
                  value={formData.aboutMe}
                  onChange={(e) => setFormData({ ...formData, aboutMe: e.target.value })}
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                  rows={3}
                />
              </div>
              
              {/* Photo Upload Section */}
              <div>
                <label className="block text-sm font-medium mb-2">תמונת פרופיל</label>
                <div className="flex items-center gap-4">
                  {formData.profilePhotoUrl ? (
                    <div className="relative">
                      <img 
                        src={formData.profilePhotoUrl} 
                        alt="Preview" 
                        className="w-20 h-20 object-cover rounded-full border-2 border-green-500"
                      />
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, profilePhotoUrl: '' })}
                        className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full w-6 h-6 text-sm hover:bg-red-600"
                      >
                        ✕
                      </button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-full bg-gray-100 border-2 border-dashed border-gray-300 flex items-center justify-center text-gray-400">
                      📷
                    </div>
                  )}
                  <div className="flex-1">
                    <input
                      ref={fileInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleFileUpload}
                      className="hidden"
                      id="photo-upload"
                    />
                    <label
                      htmlFor="photo-upload"
                      className={`cursor-pointer inline-flex items-center px-4 py-2 border border-gray-300 rounded-md shadow-sm text-sm font-medium text-gray-700 bg-white hover:bg-gray-50 ${uploading ? 'opacity-50 cursor-not-allowed' : ''}`}
                    >
                      {uploading ? (
                        <>
                          <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-gray-700" fill="none" viewBox="0 0 24 24">
                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                          </svg>
                          מעלה...
                        </>
                      ) : (
                        <>📤 העלה תמונה</>
                      )}
                    </label>
                    <p className="text-xs text-gray-500 mt-1">JPG, PNG עד 5MB</p>
                  </div>
                </div>
              </div>

              <button
                type="submit"
                className="w-full py-2 px-4 bg-green-600 text-white rounded-md font-bold hover:bg-green-700"
              >
                הוסף למערכת
              </button>
            </form>
          </div>

          {/* List */}
          <div className="lg:col-cols-2 lg:col-span-2">
            <div className="bg-white rounded-xl shadow-md border border-gray-200 overflow-hidden">
              <table className="min-w-full divide-y divide-gray-200">
                <thead className="bg-gray-50">
                  <tr>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">תמונה</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">שם</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">מקצוע</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">עיר</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">סטטוס</th>
                    <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">פעולות</th>
                  </tr>
                </thead>
                <tbody className="bg-white divide-y divide-gray-200">
                  {loading ? (
                    <tr><td colSpan={6} className="px-6 py-4 text-center">טוען...</td></tr>
                  ) : professionals.length === 0 ? (
                    <tr><td colSpan={6} className="px-6 py-4 text-center">אין בעלי מקצוע רשומים</td></tr>
                  ) : professionals.map((pro) => (
                    <tr key={pro._id}>
                      <td className="px-6 py-4 whitespace-nowrap">
                        {pro.profilePhotoUrl ? (
                          <img 
                            src={pro.profilePhotoUrl} 
                            alt={pro.name} 
                            className="w-10 h-10 rounded-full object-cover"
                          />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-gray-200 flex items-center justify-center text-gray-500 text-sm">
                            👤
                          </div>
                        )}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <div className="text-sm font-medium text-gray-900">{pro.name}</div>
                        <div className="text-sm text-gray-500">{pro.phone}</div>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        {getProfessionName(pro.profession)}
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">{pro.city}</td>
                      <td className="px-6 py-4 whitespace-nowrap">
                        <span className="px-2 inline-flex text-xs leading-5 font-semibold rounded-full bg-green-100 text-green-800">
                          מאומת
                        </span>
                      </td>
                      <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-500">
                        <button
                          onClick={() => handleDelete(pro._id)}
                          className="text-red-600 hover:text-red-900 font-bold"
                        >
                          מחק
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
