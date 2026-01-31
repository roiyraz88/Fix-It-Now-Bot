'use client';

import { useState, useEffect } from 'react';

export default function Home() {
  const [dbStatus, setDbStatus] = useState<string>('Checking DB...');
  const [status, setStatus] = useState<string>('Checking WhatsApp...');
  const [phoneNumber, setPhoneNumber] = useState('');
  const [message, setMessage] = useState('');
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const [webhookUrl, setWebhookUrl] = useState('');
  const [webhookLoading, setWebhookLoading] = useState(false);

  useEffect(() => {
    async function checkStatus() {
      try {
        const res = await fetch('/api/wa-status');
        const data = await res.json();
        setStatus(data.stateInstance || 'Unknown');
      } catch (error) {
        setStatus('Error connecting to Green API');
      }
    }

    async function checkDb() {
      try {
        const res = await fetch('/api/db-check');
        const data = await res.json();
        setDbStatus(data.status === 'connected' ? 'Connected' : 'Error');
      } catch (error) {
        setDbStatus('Error');
      }
    }

    checkStatus();
    checkDb();
  }, []);

  const handleSendMessage = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    try {
      const res = await fetch('/api/send-message', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phoneNumber, message }),
      });
      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to send message' });
    } finally {
      setLoading(false);
    }
  };

  const handleSetWebhook = async (e: React.FormEvent) => {
    e.preventDefault();
    setWebhookLoading(true);
    try {
      const res = await fetch('/api/set-webhook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: webhookUrl }),
      });
      const data = await res.json();
      setResult(data);
    } catch (error) {
      setResult({ error: 'Failed to set webhook' });
    } finally {
      setWebhookLoading(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24 bg-gray-50">
      <div className="z-10 w-full max-w-md items-center justify-between font-mono text-sm bg-white p-8 rounded-xl shadow-lg border border-gray-200">
        <h1 className="text-2xl font-bold mb-6 text-center text-green-600">WhatsApp Green API</h1>
        
        <div className="mb-6 space-y-4">
          <div className="p-4 bg-gray-100 rounded-lg">
            <p className="font-semibold text-xs text-gray-500 uppercase">WhatsApp Instance:</p>
            <span className={`inline-block px-2 py-1 rounded text-xs font-bold mt-1 ${status === 'authorized' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
              {status.toUpperCase()}
            </span>
          </div>

          <div className="p-4 bg-gray-100 rounded-lg">
            <p className="font-semibold text-xs text-gray-500 uppercase">MongoDB Status:</p>
            <span className={`inline-block px-2 py-1 rounded text-xs font-bold mt-1 ${dbStatus === 'Connected' ? 'bg-green-200 text-green-800' : 'bg-red-200 text-red-800'}`}>
              {dbStatus.toUpperCase()}
            </span>
          </div>
        </div>

        <form onSubmit={handleSendMessage} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700">Phone Number (with country code)</label>
            <input
              type="text"
              value={phoneNumber}
              onChange={(e) => setPhoneNumber(e.target.value)}
              placeholder="972559939714"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
              required
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700">Message</label>
            <textarea
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              placeholder="Hello from Next.js!"
              className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-green-500 focus:border-green-500 text-gray-900 bg-white"
              rows={3}
              required
            />
          </div>
          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 disabled:opacity-50"
          >
            {loading ? 'Sending...' : 'Send Message'}
          </button>
        </form>

        <div className="mt-8 pt-6 border-t border-gray-200">
          <h2 className="text-lg font-bold mb-4 text-gray-800">Webhook Settings</h2>
          <form onSubmit={handleSetWebhook} className="space-y-4">
            <div>
              <label className="block text-sm font-medium text-gray-700">Webhook URL (Public Address)</label>
              <input
                type="text"
                value={webhookUrl}
                onChange={(e) => setWebhookUrl(e.target.value)}
                placeholder="https://your-domain.com/api/webhook"
                className="mt-1 block w-full border border-gray-300 rounded-md shadow-sm p-2 focus:ring-blue-500 focus:border-blue-500 text-gray-900 bg-white"
                required
              />
            </div>
            <button
              type="submit"
              disabled={webhookLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:opacity-50"
            >
              {webhookLoading ? 'Configuring...' : 'Set Webhook URL'}
            </button>
          </form>
          <p className="mt-2 text-xs text-gray-500">
            Note: The bot responds to 972527345641 automatically via the webhook endpoint.
          </p>
        </div>

        {result && (
          <div className="mt-6 p-4 bg-gray-100 rounded-lg overflow-auto max-h-40">
            <p className="font-semibold mb-2">Result:</p>
            <pre className="text-xs">{JSON.stringify(result, null, 2)}</pre>
          </div>
        )}
        </div>
      </main>
  );
}
