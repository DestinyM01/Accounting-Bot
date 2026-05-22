import { Injectable, Logger } from '@nestjs/common';
import { createCanvas } from 'canvas';
import { Transaction } from '../type/interface';
import { toNormalDate } from '../common';
import { DATA_FOR, DATA_PERIOD } from '../constants';
import { ITransactionQuery } from '../type/interface/transaction.query.interface';

@Injectable()
export class ChartService {
  private readonly logger: Logger = new Logger(ChartService.name);

  async generateCustomChart(
    transactions: Transaction[],
    transactionQuery: ITransactionQuery,
    language: string,
  ): Promise<string> {
    const width = 1280;
    const height = 720;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    ctx.strokeStyle = '#ccc';
    ctx.lineWidth = 1;

    for (let y = 0; y < height; y += 20) {
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(width, y);
      ctx.stroke();
    }

    for (let x = 0; x < width; x += 20) {
      ctx.beginPath();
      ctx.moveTo(x, 0);
      ctx.lineTo(x, height);
      ctx.stroke();
    }
    const timestamp = transactionQuery.timestamp;
    let chartTitle = ``;
    if (timestamp !== undefined) {
      if (timestamp.$lte !== undefined) {
        const startDate = await toNormalDate(timestamp.$gte);
        const endDate = await toNormalDate(timestamp.$lte);
        chartTitle = `${DATA_PERIOD(startDate, endDate, language || 'en')}`;
      } else {
        const startDate = await toNormalDate(timestamp.$gte);
        chartTitle = `${DATA_FOR[language || 'en']} ${startDate}\n`;
      }
    }

    ctx.fillStyle = '#000';
    ctx.font = 'bold 20px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(chartTitle, width / 2, 30);

    const mergedTransactionsMap = new Map<string, number>();

    for (const transaction of transactions) {
      const { transactionName, amount } = transaction;
      const existingAmount = mergedTransactionsMap.get(transactionName) || 0;
      mergedTransactionsMap.set(transactionName, existingAmount + amount);
    }

    const mergedTransactions = Array.from(mergedTransactionsMap.entries()).map(([transactionName, amount]) => ({
      transactionName,
      amount,
    }));

    const positiveTransactions = mergedTransactions.filter((transaction) => transaction.amount > 0);
    const negativeTransactions = mergedTransactions.filter((transaction) => transaction.amount < 0);

    const totalPositiveValue = positiveTransactions.reduce((sum, { amount }) => sum + amount, 0);
    const totalNegativeValue = Math.abs(negativeTransactions.reduce((sum, { amount }) => sum + amount, 0));

    const radius = Math.min(width, height) * 0.4;
    const centerY = height / 2;

    let startAngle = -Math.PI / 2;
    let centerX = width / 4.2;

    await this.drawTransactions(ctx, positiveTransactions, totalPositiveValue, startAngle, centerX, centerY, radius);

    startAngle = -Math.PI / 2;
    centerX = (width * 2.3) / 3;

    await this.drawTransactions(ctx, negativeTransactions, totalNegativeValue, startAngle, centerX, centerY, radius);
    const imageDataUrl = canvas.toDataURL();
    return imageDataUrl.replace(/^data:image\/png;base64,/, '');
  }

  async drawTransactions(
    ctx: any,
    transactions: { transactionName: string; amount: number }[],
    totalValue: number,
    startAngle: number,
    centerX: number,
    centerY: number,
    radius: number,
  ): Promise<void> {
    const totalAmount = transactions.reduce((sum, { amount }) => sum + amount, 0);
    const textPadding = 20;

    for (const { transactionName, amount } of transactions) {
      const percentageChart = Math.abs(amount) / totalValue;
      const endAngle = startAngle + percentageChart * 2 * Math.PI;

      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();

      ctx.fillStyle = await this.getRandomColor();
      ctx.fill();

      const midAngle = (startAngle + endAngle) / 2;

      const textX = centerX + (radius + textPadding) * Math.cos(midAngle);
      const textY = centerY + (radius + textPadding) * Math.sin(midAngle);

      ctx.translate(textX, textY);
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = '#000';
      ctx.font = 'bold 16px Arial';
      ctx.fillText(`${transactionName} (${amount}) ${Math.round(percentageChart * 100)}%`, 0, 0);
      ctx.translate(-textX, -textY);

      startAngle = endAngle;

      const textUnderTable = `Total: ${totalAmount}`;
      ctx.fillStyle = '#000';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(textUnderTable, centerX, centerY + radius + 40);

      const textUpTable = totalAmount >= 0 ? 'Positive transactions:' : 'Negative transactions:';
      ctx.fillStyle = '#000';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      ctx.fillText(textUpTable, centerX, centerY - radius - 40);
    }
  }
  // ─── Category expense pie chart ──────────────────────────────────────────────
  async generateCategoryPieChart(categoryTotals: Record<string, number>, title: string): Promise<string> {
    const entries = Object.entries(categoryTotals)
      .filter(([, v]) => v > 0)
      .sort((a, b) => b[1] - a[1]);

    if (entries.length === 0) throw new Error('No category data');

    const width = 900;
    const height = 660;
    const canvas = createCanvas(width, height);
    const ctx = canvas.getContext('2d');

    // Background
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(0, 0, width, height);

    // Title
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 22px Arial';
    ctx.textAlign = 'center';
    ctx.fillText(title, width / 2, 36);

    const total = entries.reduce((s, [, v]) => s + v, 0);
    const COLORS = ['#e74c3c', '#3498db', '#2ecc71', '#f39c12', '#9b59b6', '#1abc9c', '#e67e22', '#95a5a6'];

    const radius = 210;
    const centerX = width / 2;
    const centerY = 310;

    // Draw slices
    let startAngle = -Math.PI / 2;
    entries.forEach(([, amount], i) => {
      const pct = amount / total;
      const endAngle = startAngle + pct * 2 * Math.PI;
      ctx.beginPath();
      ctx.moveTo(centerX, centerY);
      ctx.arc(centerX, centerY, radius, startAngle, endAngle);
      ctx.closePath();
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fill();
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 2;
      ctx.stroke();
      startAngle = endAngle;
    });

    // Percentage labels outside slices (only for slices > 5%)
    startAngle = -Math.PI / 2;
    entries.forEach(([, amount], i) => {
      const pct = amount / total;
      const endAngle = startAngle + pct * 2 * Math.PI;
      if (pct > 0.05) {
        const mid = (startAngle + endAngle) / 2;
        const lx = centerX + (radius + 30) * Math.cos(mid);
        const ly = centerY + (radius + 30) * Math.sin(mid);
        ctx.fillStyle = '#2c3e50';
        ctx.font = 'bold 13px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(`${Math.round(pct * 100)}%`, lx, ly);
      }
      startAngle = endAngle;
    });

    // Total label in center
    ctx.fillStyle = '#2c3e50';
    ctx.font = 'bold 16px Arial';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(`Total`, centerX, centerY - 12);
    ctx.fillText(total.toLocaleString('en-US', { maximumFractionDigits: 0 }), centerX, centerY + 12);

    // Legend at the bottom
    const legendTop = height - 110;
    const cols = Math.min(entries.length, 4);
    const colWidth = width / cols;
    entries.forEach(([category, amount], i) => {
      const row = Math.floor(i / 4);
      const col = i % 4;
      const lx = col * colWidth + 20;
      const ly = legendTop + row * 28;
      ctx.fillStyle = COLORS[i % COLORS.length];
      ctx.fillRect(lx, ly, 14, 14);
      ctx.fillStyle = '#2c3e50';
      ctx.font = '13px Arial';
      ctx.textAlign = 'left';
      ctx.textBaseline = 'top';
      const label = `${category}: ${amount.toLocaleString('en-US', { maximumFractionDigits: 0 })}`;
      ctx.fillText(label, lx + 20, ly);
    });

    const imageData = canvas.toDataURL();
    return imageData.replace(/^data:image\/png;base64,/, '');
  }

  private async getRandomColor(): Promise<string> {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
      color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
  }

  private getTimeScale(
    startDate: Date,
    endDate: Date,
  ): {
    scale: 'day' | 'week' | 'month';
    format: string;
    groupingFn: (date: Date) => string;
  } {
    const diffInDays = Math.ceil((endDate.getTime() - startDate.getTime()) / (1000 * 60 * 60 * 24));

    if (diffInDays <= 31) {
      // For periods up to a month, show daily data
      return {
        scale: 'day',
        format: 'dd.MM',
        groupingFn: (date: Date) => date.toISOString().split('T')[0],
      };
    } else if (diffInDays <= 180) {
      // For periods up to 6 months, show weekly data
      return {
        scale: 'week',
        format: 'dd.MM',
        groupingFn: (date: Date) => {
          const weekStart = new Date(date);
          weekStart.setDate(date.getDate() - date.getDay());
          return weekStart.toISOString().split('T')[0];
        },
      };
    } else {
      // For longer periods, show monthly data
      return {
        scale: 'month',
        format: 'MM.yyyy',
        groupingFn: (date: Date) => {
          return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
        },
      };
    }
  }

  private formatDate(date: Date, format: string): string {
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();

    return format.replace('dd', day).replace('MM', month).replace('yyyy', year.toString());
  }

  async generateDailyTransactionChart(transactions: Transaction[]): Promise<string> {
    try {
      this.logger.log(`Starting to generate chart. Received ${transactions.length} transactions`);

      if (!transactions || transactions.length === 0) {
        this.logger.warn('No transactions provided for chart generation');
        throw new Error('No transactions provided');
      }

      const width = 1280;
      const height = 720;
      const padding = 60;

      this.logger.log('Creating canvas');
      const canvas = createCanvas(width, height);
      const ctx = canvas.getContext('2d');
      const chartWidth = width - 2 * padding;
      const chartHeight = height - 2 * padding;

      // Sort transactions by date and get time range
      const sortedTransactions = [...transactions].sort(
        (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime(),
      );
      const startDate = new Date(sortedTransactions[0].timestamp);
      const endDate = new Date(sortedTransactions[sortedTransactions.length - 1].timestamp);

      // Determine the appropriate time scale
      const timeScale = this.getTimeScale(startDate, endDate);
      this.logger.log(`Using time scale: ${timeScale.scale}`);

      // Group transactions by the determined scale
      const groupedTotals = new Map<string, { positive: number; negative: number }>();

      transactions.forEach((transaction) => {
        const date = new Date(transaction.timestamp);
        const groupKey = timeScale.groupingFn(date);
        const current = groupedTotals.get(groupKey) || { positive: 0, negative: 0 };

        if (transaction.amount >= 0) {
          current.positive += transaction.amount;
        } else {
          current.negative += transaction.amount;
        }

        groupedTotals.set(groupKey, current);
      });

      this.logger.log(`Grouped into ${groupedTotals.size} ${timeScale.scale} entries`);

      const groupedDates = Array.from(groupedTotals.keys()).sort();

      // Find min and max values for scaling.
      // Expenses are stored as negative amounts but we display them as positive
      // so both income and expense lines live in the same positive Y space.
      const minTotal = 0; // Y-axis always starts at 0
      let maxTotal = 0;
      const positiveData: number[] = [];
      const negativeData: number[] = [];

      groupedDates.forEach((date) => {
        const { positive, negative } = groupedTotals.get(date)!;
        positiveData.push(positive);
        negativeData.push(Math.abs(negative)); // absolute value — expenses shown positive
        maxTotal = Math.max(maxTotal, positive, Math.abs(negative));
      });

      // 10% headroom at the top; bottom is fixed at 0
      maxTotal = maxTotal > 0 ? maxTotal * 1.1 : 100;

      // Draw background and title
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, width, height);

      ctx.fillStyle = '#2c3e50';
      ctx.font = 'bold 20px Arial';
      ctx.textAlign = 'center';
      const periodText = `${timeScale.scale === 'day' ? 'Daily' : timeScale.scale === 'week' ? 'Weekly' : 'Monthly'}`;
      ctx.fillText(`${periodText} Transaction Summary for ${transactions[0].transactionName}`, width / 2, padding / 2);

      // Draw axes
      ctx.strokeStyle = '#2c3e50';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(padding, padding);
      ctx.lineTo(padding, height - padding);
      ctx.lineTo(width - padding, height - padding);
      ctx.stroke();

      // Draw Y-axis labels
      ctx.fillStyle = '#2c3e50';
      ctx.font = '12px Arial';
      ctx.textAlign = 'right';

      const ySteps = 10;
      for (let i = 0; i <= ySteps; i++) {
        const value = minTotal + (maxTotal - minTotal) * (i / ySteps);
        const y = height - padding - (height - 2 * padding) * (i / ySteps);
        ctx.fillText(Math.round(value).toLocaleString('en-US'), padding - 10, y + 4);
      }

      // Draw X-axis labels with appropriate date formatting
      ctx.textAlign = 'center';
      const maxLabels = timeScale.scale === 'day' ? 10 : timeScale.scale === 'week' ? 12 : 12;
      const step = Math.ceil(groupedDates.length / maxLabels);

      groupedDates.forEach((dateStr, i) => {
        if (i % step === 0) {
          const x = groupedDates.length === 1
            ? padding + chartWidth / 2
            : padding + chartWidth * (i / (groupedDates.length - 1));
          const date = new Date(dateStr);
          const label = this.formatDate(date, timeScale.format);

          ctx.save();
          ctx.translate(x, height - padding + 20);
          ctx.rotate(Math.PI / 4);
          ctx.fillText(label, 0, 0);
          ctx.restore();
        }
      });

      // Draw grid
      ctx.strokeStyle = '#e5e5e5';
      ctx.lineWidth = 1;
      for (let i = 0; i <= ySteps; i++) {
        const y = padding + chartHeight * (i / ySteps);
        ctx.beginPath();
        ctx.moveTo(padding, y);
        ctx.lineTo(padding + chartWidth, y);
        ctx.stroke();
      }

      // Draw data lines
      const getX = (i: number) =>
        groupedDates.length === 1
          ? padding + chartWidth / 2
          : padding + chartWidth * (i / (groupedDates.length - 1));

      const getY = (value: number) => {
        const range = maxTotal - minTotal;
        if (range === 0) return padding + chartHeight / 2;
        return padding + chartHeight - chartHeight * ((value - minTotal) / range);
      };

      const drawLine = (data: number[], color: string) => {
        ctx.strokeStyle = color;
        ctx.lineWidth = 2;
        ctx.beginPath();

        data.forEach((value, i) => {
          const x = getX(i);
          const y = getY(value);
          if (i === 0) ctx.moveTo(x, y);
          else ctx.lineTo(x, y);
        });

        ctx.stroke();

        // Draw points
        data.forEach((value, i) => {
          ctx.beginPath();
          ctx.arc(getX(i), getY(value), 5, 0, Math.PI * 2);
          ctx.fillStyle = color;
          ctx.fill();
        });
      };

      drawLine(positiveData, '#198754');
      drawLine(negativeData, '#dc3545');

      // Draw legend
      const legendY = padding / 2;
      ctx.font = '14px Arial';

      ctx.fillStyle = '#198754';
      ctx.fillRect(width - padding - 200, legendY - 8, 16, 16);
      ctx.fillStyle = '#2c3e50';
      ctx.fillText('Income', width - padding - 175, legendY + 4);

      ctx.fillStyle = '#dc3545';
      ctx.fillRect(width - padding - 100, legendY - 8, 16, 16);
      ctx.fillStyle = '#2c3e50';
      ctx.fillText('Expenses', width - padding - 75, legendY + 4);

      const imageData = canvas.toDataURL();
      return imageData.replace(/^data:image\/png;base64,/, '');
    } catch (error) {
      this.logger.error('Error generating chart', error);
      throw error;
    }
  }
}
