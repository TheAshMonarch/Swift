import { Injectable, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import axios from 'axios';
import * as crypto from 'crypto';

export interface Bank {
  name: string;
  code: string;
}

interface PaystackBankPage {
  data?: { name: string; code: string; active?: boolean; is_deleted?: boolean }[];
  meta?: { next?: string | null };
}

const BANKS_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class PaymentsService {
  private readonly baseUrl = 'https://api.paystack.co';
  private readonly headers: Record<string, string>;
  private banksCache?: { expiresAt: number; banks: Promise<Bank[]> };

  constructor(private config: ConfigService) {
    this.headers = {
      Authorization: `Bearer ${this.config.get<string>('PAYSTACK_SECRET_KEY')}`,
      'Content-Type': 'application/json',
    };
  }

  async initializeTransaction(params: {
    email: string;
    amountKobo: number;
    reference: string;
    metadata?: Record<string, any>;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transaction/initialize`,
      {
        email: params.email,
        amount: params.amountKobo,
        reference: params.reference,
        metadata: params.metadata,
        callback_url: this.config.get<string>('PAYSTACK_CALLBACK_URL'),
      },
      { headers: this.headers },
    );
    return data.data;
  }

  async verifyTransaction(reference: string) {
    const { data } = await axios.get(
      `${this.baseUrl}/transaction/verify/${reference}`,
      { headers: this.headers },
    );
    if (data.data.status !== 'success') {
      throw new BadRequestException('Payment verification failed');
    }
    return data.data;
  }

  async createTransferRecipient(params: {
    name: string;
    accountNumber: string;
    bankCode: string;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transferrecipient`,
      {
        type: 'nuban',
        name: params.name,
        account_number: params.accountNumber,
        bank_code: params.bankCode,
        currency: 'NGN',
      },
      { headers: this.headers },
    );
    return data.data;
  }

  async initiateTransfer(params: {
    amountKobo: number;
    recipientCode: string;
    reference: string;
    reason: string;
  }) {
    const { data } = await axios.post(
      `${this.baseUrl}/transfer`,
      {
        source: 'balance',
        amount: params.amountKobo,
        recipient: params.recipientCode,
        reference: params.reference,
        reason: params.reason,
      },
      { headers: this.headers },
    );
    return data.data;
  }

  async refundTransaction(transactionId: string, amountKobo?: number) {
    const { data } = await axios.post(
      `${this.baseUrl}/refund`,
      { transaction: transactionId, amount: amountKobo },
      { headers: this.headers },
    );
    return data.data;
  }

  // Nigerian banks for payout setup, cached in memory (the list rarely changes).
  // Caches the in-flight promise so concurrent callers share one Paystack fetch.
  async getBanks(): Promise<Bank[]> {
    if (this.banksCache && this.banksCache.expiresAt > Date.now()) {
      return this.banksCache.banks;
    }
    const banks = this.fetchBanks();
    this.banksCache = { expiresAt: Date.now() + BANKS_CACHE_TTL_MS, banks };
    banks.catch(() => (this.banksCache = undefined)); // don't cache failures
    return banks;
  }

  private async fetchBanks(): Promise<Bank[]> {
    const banks: Bank[] = [];
    let next: string | null = null;
    // Paystack paginates by cursor; guard against an endless loop.
    for (let page = 0; page < 20; page++) {
      const { data }: { data: PaystackBankPage } = await axios.get(`${this.baseUrl}/bank`, {
        headers: this.headers,
        params: { currency: 'NGN', use_cursor: true, perPage: 100, ...(next ? { next } : {}) },
      });
      for (const bank of data.data ?? []) {
        if (bank.active !== false && !bank.is_deleted) {
          banks.push({ name: bank.name, code: bank.code });
        }
      }
      next = data.meta?.next ?? null;
      if (!next) break;
    }
    return banks.sort((a, b) => a.name.localeCompare(b.name));
  }

  generateReference(prefix = 'artiz'): string {
    return `${prefix}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  // ← NEW: Paystack sends a signature so you can confirm it's really them
  verifyWebhookSignature(signature: string, rawBody: string): boolean {
    const hash = crypto
      .createHmac('sha512', this.config.get<string>('PAYSTACK_SECRET_KEY')!)
      .update(rawBody)
      .digest('hex');
    return hash === signature;
  }
}