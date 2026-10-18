<?php
declare(strict_types=1);
namespace ZTOrders;

final class RequestError extends \RuntimeException
{
    public function __construct(public readonly string $errorCode, public readonly int $status, string $message)
    {
        parent::__construct($message);
    }
}

function text(mixed $value, string $field, int $max, bool $required = false): string
{
    if (!is_string($value) || !preg_match('//u', $value)) {
        throw new RequestError('INVALID_FIELDS', 422, 'Проверьте поле: ' . $field);
    }
    $value = trim(str_replace(["\r\n", "\r"], "\n", $value));
    if (preg_match('/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/u', $value)
        || preg_match_all('/./us', $value) > $max || ($required && $value === '')) {
        throw new RequestError('INVALID_FIELDS', 422, 'Проверьте поле: ' . $field);
    }
    return $value;
}

function normalizeRequest(array $input, ?\DateTimeImmutable $today = null, bool $checkDateRange = true): array
{
    $allowed = ['kind', 'subject', 'name', 'phone', 'channel', 'date', 'delivery', 'time', 'address',
        'comment', 'consent', 'consentVersion', 'quantity', 'budget', 'items', 'website', 'requestType'];
    if (array_diff(array_keys($input), $allowed)) {
        throw new RequestError('INVALID_FIELDS', 422, 'Неизвестные поля запроса.');
    }
    if (($input['website'] ?? '') !== '') {
        throw new RequestError('INVALID_FIELDS', 422, 'Не удалось принять обращение.');
    }
    $kind = $input['kind'] ?? '';
    if (!in_array($kind, ['order', 'inquiry'], true)) {
        throw new RequestError('INVALID_FIELDS', 422, 'Неизвестный тип обращения.');
    }
    $requestType = $input['requestType'] ?? ($kind === 'order' ? 'cart' : 'other');
    if (!in_array($requestType, ['cart','gift','large','corporate','question','preorder','other'], true)
        || ($kind === 'order') !== ($requestType === 'cart')) {
        throw new RequestError('INVALID_FIELDS', 422, 'Проверьте тип заявки.');
    }
    $name = text($input['name'] ?? null, 'имя', 80, true);
    $phone = preg_replace('/[\s()+-]/u', '', text($input['phone'] ?? null, 'телефон', 24, true));
    if (!preg_match('/^7\d{10}$/D', $phone)) {
        throw new RequestError('INVALID_FIELDS', 422, 'Введите телефон из 11 цифр, начиная с 7.');
    }
    $channel = $input['channel'] ?? '';
    if (!in_array($channel, ['MAX', 'VK', 'Телефон'], true)) {
        throw new RequestError('INVALID_FIELDS', 422, 'Выберите способ связи.');
    }
    if (($input['consent'] ?? false) !== true || ($input['consentVersion'] ?? '') !== '2026-10-requests-v2') {
        throw new RequestError('CONSENT_REQUIRED', 422, 'Необходимо согласие на обработку данных.');
    }
    $date = text($input['date'] ?? '', 'дата', 10);
    $today ??= new \DateTimeImmutable('today', new \DateTimeZone('Asia/Yekaterinburg'));
    if ($date !== '') {
        $parsed = \DateTimeImmutable::createFromFormat('!Y-m-d', $date, $today->getTimezone());
        if (!$parsed || $parsed->format('Y-m-d') !== $date || ($checkDateRange && ($date < $today->format('Y-m-d')
            || $date > $today->modify('+2 years')->format('Y-m-d')))) {
            throw new RequestError('INVALID_FIELDS', 422, 'Проверьте желаемую дату.');
        }
    }
    $delivery = text($input['delivery'] ?? '', 'получение', 20);
    $time = text($input['time'] ?? '', 'время', 10);
    $address = text($input['address'] ?? '', 'адрес', 250);
    if ($kind === 'order') {
        if (!in_array($delivery, ['Самовывоз', 'Доставка'], true)
            || !in_array($time, ['10-13', '13-16', '16-19', '19-22'], true)
            || ($delivery === 'Доставка' && $address === '')) {
            throw new RequestError('INVALID_FIELDS', 422, 'Проверьте получение, время и адрес.');
        }
        if ($delivery === 'Самовывоз') $address = '';
    } elseif ($delivery !== '' || $time !== '' || $address !== '') {
        throw new RequestError('INVALID_FIELDS', 422, 'Проверьте параметры обращения.');
    }
    $quantity = $input['quantity'] ?? null;
    $budget = $input['budget'] ?? null;
    if (($quantity !== null && (!is_int($quantity) || $quantity < 1 || $quantity > 10000))
        || ($budget !== null && (!is_int($budget) || $budget < 1 || $budget > 1000000))) {
        throw new RequestError('INVALID_FIELDS', 422, 'Проверьте количество и бюджет.');
    }
    $items = $input['items'] ?? null;
    if (!is_array($items) || !array_is_list($items) || count($items) > 50
        || ($kind === 'order' && count($items) < 1) || ($kind === 'inquiry' && count($items) !== 0)) {
        throw new RequestError('INVALID_ITEMS', 422, 'Проверьте корзину.');
    }
    $normalizedItems = [];
    $seen = [];
    $totalQuantity = 0;
    foreach ($items as $item) {
        if (!is_array($item) || array_diff(array_keys($item), ['id', 'quantity', 'name'])
            || !is_string($item['id'] ?? null) || !preg_match('/^[a-z0-9-]{1,100}$/D', $item['id'])
            || !is_int($item['quantity'] ?? null) || $item['quantity'] < 1 || $item['quantity'] > 99
            || isset($seen[$item['id']])) {
            throw new RequestError('INVALID_ITEMS', 422, 'Проверьте товары и количество в корзине.');
        }
        $seen[$item['id']] = true;
        $totalQuantity += $item['quantity'];
        $normalizedItems[] = ['id' => $item['id'], 'quantity' => $item['quantity'],
            'name' => text($item['name'] ?? null, 'название товара', 255, true)];
    }
    if ($totalQuantity > 500) throw new RequestError('INVALID_ITEMS', 422, 'Слишком много товаров.');
    usort($normalizedItems, fn(array $a, array $b): int => strcmp($a['id'], $b['id']));
    if ($requestType === 'question' && text($input['comment'] ?? '', 'вопрос', 1500) === '') {
        throw new RequestError('INVALID_FIELDS', 422, 'Напишите ваш вопрос.');
    }
    return [
        'kind' => $kind, 'requestType' => $requestType, 'subject' => text($input['subject'] ?? null, 'тема', 300, true),
        'name' => $name, 'phone' => $phone, 'channel' => $channel, 'date' => $date,
        'delivery' => $delivery, 'time' => $time, 'address' => $address,
        'comment' => text($input['comment'] ?? '', 'пожелания', 1500),
        'consent' => true, 'consentVersion' => '2026-10-requests-v2',
        'quantity' => $quantity, 'budget' => $budget, 'items' => $normalizedItems,
    ];
}

/** Customer text is a request, never a trusted product or confirmed price. */
function requestItems(array $request): array {
    $items = [];
    foreach ($request['items'] as $item) {
        $items[] = ['id'=>$item['id'], 'name'=>$item['name'], 'quantity'=>$item['quantity'],
            'unitPriceKopecks'=>null, 'lineTotalKopecks'=>null, 'madeToOrder'=>false,
            'snapshot'=>['source'=>'customer_request','name'=>$item['name'],'priceConfirmed'=>false]];
    }
    return ['items'=>$items,'totalKopecks'=>null];
}
