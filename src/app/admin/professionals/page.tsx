'use client';

import { useState, useEffect } from 'react';

const professions = {
  plumber: { label: 'אינסטלטור', emoji: '🪠', color: 'text-blue-400' },
  electrician: { label: 'חשמלאי', emoji: '⚡', color: 'text-yellow-400' },
  ac: { label: 'טכנאי מזגנים', emoji: '❄️', color: 'text-cyan-400' },
};

export default function ProfessionalsAdmin() {
  const [professionals, setProfessionals] = useState<any[]>([]);
  const [form, setForm] = useState({
    name: '',
    phone: '',
    profession: 'plumber',
    city: '',
    experienceYears: 0,
    verified: false,
    description: '',
    aboutMe: ''
  });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch('/api/professionals').then(res => res.json()).then(setProfessionals);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/professionals', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(form)
      });
      const data = await res.json();
      if (res.ok) {
        setProfessionals([...professionals, data]);
        setForm({ name: '', phone: '', profession: 'plumber', city: '', experienceYears: 0, verified: false, description: '', aboutMe: '' });
      } else {
        alert(data.error || 'שגיאה בהוספת איש מקצוע');
      }
    } catch (error) {
      alert('שגיאה בתקשורת עם השרת');
    }
    setLoading(false);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('האם אתה בטוח שברצונך למחוק איש מקצוע זה?')) return;
    
    const res = await fetch(`/api/professionals?id=${id}`, {
      method: 'DELETE'
    });
    
    if (res.ok) {
      setProfessionals(professionals.filter(p => p._id !== id));
    } else {
      alert('שגיאה במחיקת איש מקצוע');
    }
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 p-4 md:p-8 font-sans" dir="rtl">
      <div className="max-w-6xl mx-auto">
        {/* Header */}
        <div className="flex items-center justify-between mb-12">
          <div>
            <h1 className="text-4xl font-black bg-gradient-to-l from-blue-400 to-emerald-400 bg-clip-text text-transparent">
              FixItNow Admin
            </h1>
            <p className="text-slate-400 mt-2 text-lg">ניהול ובקרת אנשי מקצוע במערכת</p>
          </div>
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-2xl shadow-xl">
            <span className="text-3xl font-bold text-blue-400">{professionals.length}</span>
            <span className="text-slate-500 mr-2 text-sm">רשומים</span>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          {/* Form Section */}
          <div className="lg:col-span-1">
            <form onSubmit={handleSubmit} className="bg-slate-900 border border-slate-800 p-6 rounded-3xl shadow-2xl sticky top-8">
              <h2 className="text-xl font-bold mb-6 flex items-center gap-2">
                <span className="bg-blue-500/20 text-blue-400 p-2 rounded-lg text-sm">✚</span>
                הוספת איש מקצוע
              </h2>
              
              <div className="space-y-5">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">שם מלא</label>
                  <input
                    type="text"
                    value={form.name}
                    onChange={e => setForm({...form, name: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white placeholder:text-slate-700"
                    placeholder="ישראל ישראלי"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">מספר טלפון</label>
                  <input
                    type="text"
                    value={form.phone}
                    onChange={e => setForm({...form, phone: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white ltr"
                    placeholder="972501234567"
                    required
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">קצת על עצמי (יוצג ללקוח)</label>
                  <textarea
                    value={form.aboutMe}
                    onChange={e => setForm({...form, aboutMe: e.target.value})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white h-24"
                    placeholder="למשל: מומחה לאיתור נזילות עם מכשור מתקדם..."
                    required
                  />
                </div>

                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">מקצוע</label>
                    <select
                      value={form.profession}
                      onChange={e => setForm({...form, profession: e.target.value as any})}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white"
                    >
                      <option value="plumber">אינסטלטור</option>
                      <option value="electrician">חשמלאי</option>
                      <option value="ac">טכנאי מזגנים</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">עיר</label>
                    <input
                      type="text"
                      value={form.city}
                      onChange={e => setForm({...form, city: e.target.value})}
                      className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white"
                      placeholder="תל אביב"
                      required
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-2 mr-1">שנות ניסיון</label>
                  <input
                    type="number"
                    value={form.experienceYears}
                    onChange={e => setForm({...form, experienceYears: parseInt(e.target.value)})}
                    className="w-full bg-slate-950 border border-slate-800 rounded-xl p-3 focus:ring-2 focus:ring-blue-500 outline-none transition-all text-white"
                    required
                  />
                </div>

                <div className="flex items-center gap-3 bg-slate-950 p-4 rounded-xl border border-slate-800">
                  <input
                    type="checkbox"
                    checked={form.verified}
                    onChange={e => setForm({...form, verified: e.target.checked})}
                    className="w-5 h-5 rounded border-slate-800 text-emerald-500 focus:ring-emerald-500 bg-slate-900"
                    id="verified"
                  />
                  <label htmlFor="verified" className="text-sm font-bold text-slate-300 cursor-pointer">
                    מאומת ומוכן לקבל עבודות
                  </label>
                </div>

                <button 
                  type="submit" 
                  disabled={loading}
                  className="w-full bg-gradient-to-r from-blue-600 to-blue-500 hover:from-blue-500 hover:to-blue-400 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-900/20 transition-all disabled:opacity-50"
                >
                  {loading ? 'מוסיף...' : 'הוסף איש מקצוע למערכת'}
                </button>
              </div>
            </form>
          </div>

          {/* List Section */}
          <div className="lg:col-span-2">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl shadow-2xl overflow-hidden">
              <div className="p-6 border-b border-slate-800 flex items-center justify-between bg-slate-900/50">
                <h2 className="text-xl font-bold">רשימת אנשי מקצוע פעילים</h2>
                <div className="flex gap-2">
                  <div className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse"></div>
                  <span className="text-xs text-slate-500 font-mono">LIVE DATABASE</span>
                </div>
              </div>
              
              <div className="overflow-x-auto">
                <table className="w-full text-right">
                  <thead>
                    <tr className="bg-slate-950/50 text-slate-500 text-xs uppercase tracking-widest">
                      <th className="p-5 font-semibold">איש מקצוע</th>
                      <th className="p-5 font-semibold">התמחות</th>
                      <th className="p-5 font-semibold">מיקום</th>
                      <th className="p-5 font-semibold">סטטוס</th>
                      <th className="p-5 font-semibold text-center">פעולות</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {professionals.length === 0 && (
                      <tr>
                        <td colSpan={5} className="p-10 text-center text-slate-600 italic">
                          טרם נוספו אנשי מקצוע למערכת...
                        </td>
                      </tr>
                    )}
                    {professionals.map(pro => (
                      <tr key={pro._id} className="hover:bg-slate-800/30 transition-colors group">
                        <td className="p-5">
                          <div className="flex items-center gap-3">
                            <div className="h-10 w-10 rounded-full bg-slate-800 flex items-center justify-center text-lg shadow-inner group-hover:scale-110 transition-transform">
                              {pro.name.charAt(0)}
                            </div>
                            <div>
                              <div className="font-bold text-slate-200">{pro.name}</div>
                              <div className="text-xs text-slate-500 font-mono">{pro.phone}</div>
                            </div>
                          </div>
                        </td>
                        <td className="p-5">
                          <div className={`flex items-center gap-2 font-medium ${professions[pro.profession as keyof typeof professions]?.color}`}>
                            <span>{professions[pro.profession as keyof typeof professions]?.emoji}</span>
                            <span>{professions[pro.profession as keyof typeof professions]?.label}</span>
                          </div>
                          <div className="text-[10px] text-slate-600 mt-1">{pro.experienceYears} שנות ניסיון</div>
                        </td>
                        <td className="p-5 text-slate-400 font-medium">
                          📍 {pro.city}
                        </td>
                        <td className="p-5">
                          <span className={`inline-flex items-center px-3 py-1 rounded-full text-[10px] font-black tracking-wider uppercase ${
                            pro.verified 
                            ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' 
                            : 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                          }`}>
                            {pro.verified ? '✓ VERIFIED' : '⚠ PENDING'}
                          </span>
                        </td>
                        <td className="p-5 text-center">
                          <button 
                            onClick={() => handleDelete(pro._id)}
                            className="text-slate-600 hover:text-rose-500 transition-colors p-2 hover:bg-rose-500/10 rounded-lg"
                            title="מחק איש מקצוע"
                          >
                            🗑️
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
    </div>
  );
}
