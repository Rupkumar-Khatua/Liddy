import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { Transaction } from '../types';
import { useFinMind } from '../context/FinMindContext';

interface TransactionModalProps {
  transaction: Transaction;
  onClose: () => void;
  onUpdate: (id: string, updates: Partial<Transaction>) => void;
}

const TransactionModal: React.FC<TransactionModalProps> = ({ transaction, onClose, onUpdate }) => {
  const { deleteTransaction, currencySymbol } = useFinMind();
  const [formData, setFormData] = useState(transaction);

  // Lock body scroll when modal is active
  useEffect(() => {
    const original = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = original;
    };
  }, []);

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: name === 'amount' ? parseFloat(value) : value
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onUpdate(transaction.id, formData);
    onClose();
  };

  const handleDelete = () => {
    deleteTransaction(transaction.id);
    onClose();
  };

  const modalContent = (
    <div className="fixed inset-0 z-[9999] flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-enter overflow-y-auto" onClick={onClose}>
      <div 
        className="bg-white dark:bg-[#121215] text-neutral-900 dark:text-white rounded-[32px] p-8 w-full max-w-md shadow-2xl border border-neutral-200/80 dark:border-neutral-800 my-auto"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex justify-between items-center mb-6">
          <h3 className="text-xl font-extrabold tracking-tight">Edit Transaction Record</h3>
          <button 
            onClick={onClose} 
            className="w-8 h-8 rounded-full bg-neutral-100 dark:bg-neutral-800 flex items-center justify-center text-neutral-500 dark:text-neutral-400 hover:bg-neutral-200 dark:hover:bg-neutral-700 transition-colors text-xs font-bold cursor-pointer"
          >
            ✕
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-mono">Merchant / Store</label>
            <input 
              type="text" 
              name="merchant"
              value={formData.merchant}
              onChange={handleChange}
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 font-bold text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 text-sm outline-none"
            />
          </div>

          <div className="flex gap-4">
            <div className="flex-1">
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-mono">Amount ({currencySymbol})</label>
              <input 
                type="number" 
                name="amount"
                step="0.01"
                value={formData.amount}
                onChange={handleChange}
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 font-mono font-bold text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 text-sm outline-none"
              />
            </div>
            <div className="flex-1">
              <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-mono">Date</label>
              <input 
                type="date" 
                name="date"
                value={formData.date}
                onChange={handleChange}
                className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 font-mono font-medium text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 text-xs outline-none"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-mono">Category</label>
            <input 
              type="text" 
              name="category"
              value={formData.category}
              onChange={handleChange}
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 font-medium text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 text-xs outline-none"
            />
          </div>

          <div>
            <label className="block text-xs font-bold text-neutral-400 uppercase tracking-wider mb-1.5 font-mono">Notes / Reference</label>
            <input 
              type="text" 
              name="notes"
              value={formData.notes || ''}
              onChange={handleChange}
              placeholder="UPI ref, bill number, etc."
              className="w-full bg-neutral-50 dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 rounded-xl px-4 py-3 font-medium text-neutral-900 dark:text-white focus:ring-2 focus:ring-indigo-500 text-xs outline-none"
            />
          </div>

          <div className="pt-4 flex gap-3">
            <button 
              type="button" 
              onClick={handleDelete}
              className="flex-1 bg-red-50 dark:bg-red-950/60 text-red-600 dark:text-red-400 py-3 rounded-xl font-bold text-xs hover:bg-red-100 dark:hover:bg-red-900 transition-colors"
            >
              Delete
            </button>
            <button 
              type="submit" 
              className="flex-[2] bg-neutral-900 hover:bg-neutral-800 dark:bg-white dark:hover:bg-neutral-100 text-white dark:text-neutral-900 py-3 rounded-xl font-bold text-xs transition-all shadow-xs"
            >
              Save Changes
            </button>
          </div>
        </form>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default TransactionModal;