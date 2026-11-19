import { builtinConnectorTypes, mergeConnectorTypes } from './builtin';
import { jiraCloudConnector } from './jira';
import { larkConnector } from './lark';
import { slackConnector } from './slack';
import type { ConnectorType } from './types';
import { webhookConnector } from './webhook';

const fake = (id: string): ConnectorType => ({ id }) as unknown as ConnectorType;

describe('builtinConnectorTypes', () => {
  it('liệt kê đúng các loại có sẵn, theo thứ tự Jira Cloud · Slack · Lark · Webhook', () => {
    expect(builtinConnectorTypes.map((t) => t.id)).toEqual(['jira-cloud', 'slack', 'lark', 'webhook']);
    expect(builtinConnectorTypes[0]).toBe(jiraCloudConnector);
    expect(builtinConnectorTypes[1]).toBe(slackConnector);
    expect(builtinConnectorTypes[2]).toBe(larkConnector);
    expect(builtinConnectorTypes[3]).toBe(webhookConnector);
  });
});

describe('mergeConnectorTypes', () => {
  it('app không khai gì ⇒ đúng danh sách có sẵn', () => {
    expect(mergeConnectorTypes()).toEqual(builtinConnectorTypes);
    expect(mergeConnectorTypes([])).toEqual(builtinConnectorTypes);
  });

  it('loại của app trùng id ⇒ thay loại có sẵn tại đúng chỗ', () => {
    const appSlack = fake('slack');

    const merged = mergeConnectorTypes([appSlack]);

    expect(merged.map((t) => t.id)).toEqual(['jira-cloud', 'slack', 'lark', 'webhook']);
    expect(merged[1]).toBe(appSlack);
  });

  it('loại mới của app ⇒ thêm vào cuối, giữ thứ tự app khai; không đổi mảng có sẵn', () => {
    const linear = fake('linear');
    const base = fake('lark-base');

    const merged = mergeConnectorTypes([linear, base]);

    expect(merged.map((t) => t.id)).toEqual([
      'jira-cloud',
      'slack',
      'lark',
      'webhook',
      'linear',
      'lark-base',
    ]);
    expect(builtinConnectorTypes.map((t) => t.id)).toEqual(['jira-cloud', 'slack', 'lark', 'webhook']);
  });

  it('app khai trùng id hai lần ⇒ bản khai sau thắng, không có hai mục cùng id', () => {
    const first = fake('linear');
    const second = fake('linear');

    const merged = mergeConnectorTypes([first, second]);

    expect(merged.filter((t) => t.id === 'linear')).toEqual([second]);
    expect(merged).toHaveLength(5);
  });
});
