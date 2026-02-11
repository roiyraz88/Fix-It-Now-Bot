'use client';

import { useState, useEffect } from 'react';

export default function ProfessionalsAdmin() {
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
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
          {/* Form */}
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
              <div>
                <label className="block text-sm font-medium">תמונת פרופיל (URL)</label>
                <input
                  type="url"
                  value={formData.profilePhotoUrl}
                  onChange={(e) => setFormData({ ...formData, profilePhotoUrl: e.target.value })}
                  placeholder="https://example.com/photo.jpg"
                  className="mt-1 block w-full border border-gray-300 rounded-md p-2 bg-white"
                />
                <p className="text-xs text-gray-500 mt-1">תישלח ללקוח עם ההצעה</p>
                {formData.profilePhotoUrl && (
                  <img 
                    src={formData.profilePhotoUrl} 
                    alt="Preview" 
                    className="mt-2 w-20 h-20 object-cover rounded-full border-2 border-green-500"
                    onError={(e) => (e.currentTarget.style.display = 'none')}
                  />
                )}
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
                        {pro.profession === 'plumber' ? 'אינסטלטור' : pro.profession === 'electrician' ? 'חשמלאי' : 'מיזוג'}
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
