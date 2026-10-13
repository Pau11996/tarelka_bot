'use strict';

// Inputs are the energy of the whole recipe and the actual cooked/portion weights.
function calculateRecipePortion(energy, weight, portion) {
    if (![energy, weight, portion].every(Number.isFinite)) {
        throw new RangeError('Заполните все поля числами.');
    }
    if (energy < 0 || weight <= 0 || portion <= 0) {
        throw new RangeError('Калории должны быть не меньше нуля, а вес блюда и порции — больше нуля.');
    }
    if ([energy, weight, portion].some((value) => value > 1000000)) {
        throw new RangeError('Проверьте единицы: укажите ккал и граммы, не больше 1 000 000 в каждом поле.');
    }
    if (portion > weight) {
        throw new RangeError('Вес порции не может превышать вес всего готового блюда.');
    }
    return { per100: energy / weight * 100, portion: energy / weight * portion };
}

if (typeof module !== 'undefined' && module.exports) {
    module.exports = { calculateRecipePortion };
}

if (typeof document !== 'undefined') {
    const form = document.querySelector('[data-recipe-calculator]');
    if (form) {
        const fields = ['energy', 'weight', 'portion'].map((name) => form.elements.namedItem(name));
        const error = document.getElementById('calculator-error');
        const per100 = document.getElementById('result-per-100');
        const portion = document.getElementById('result-portion');
        const format = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: 0 });
        form.noValidate = true;
        form.addEventListener('submit', (event) => {
            event.preventDefault();
            try {
                const values = fields.map((field) => field.valueAsNumber);
                const result = calculateRecipePortion(...values);
                per100.value = `${format.format(result.per100)} ккал`;
                portion.value = `${format.format(result.portion)} ккал`;
                error.hidden = true;
                fields.forEach((field) => field.removeAttribute('aria-invalid'));
                // Only the successful action is measured, never entered nutrition values.
                document.dispatchEvent(new CustomEvent('tarelka:recipe-calculated'));
            } catch (problem) {
                per100.value = '—';
                portion.value = '—';
                error.textContent = problem.message;
                error.hidden = false;
                const invalid = fields.find((field) => !field.validity.valid) || fields[2];
                invalid.setAttribute('aria-invalid', 'true');
                invalid.focus();
            }
        });
        form.addEventListener('input', () => {
            per100.value = '—';
            portion.value = '—';
            error.hidden = true;
            fields.forEach((field) => field.removeAttribute('aria-invalid'));
        });
        // Until the handler is attached, disabled controls prevent a no-JS GET submission.
        form.querySelector('[data-calculator-controls]').disabled = false;
    }
}
