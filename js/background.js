/**
 * VocabMeld 后台脚本
 * 处理扩展级别的事件和消息
 */

// 安装/更新时初始化
chrome.runtime.onInstalled.addListener((details) => {
  console.log('[VocabMeld] Extension installed/updated:', details.reason);
  
  // 设置默认配置
  if (details.reason === 'install') {
    chrome.storage.sync.set({
      apiEndpoint: 'https://api.deepseek.com/chat/completions',
      apiKey: '',
      modelName: 'deepseek-chat',
      apiProtocol: 'openai_compatible',
      reasoningEffort: '',
      nativeLanguage: 'zh-CN',
      targetLanguage: 'en',
      difficultyLevel: 'B1',
      intensity: 'medium',
      autoProcess: true,
      showPhonetic: true,
      translationStyle: 'translation-original',
      enabled: true,
      siteMode: 'all',
      excludedSites: [],
      allowedSites: [],
      totalWords: 0,
      todayWords: 0,
      lastResetDate: new Date().toISOString().split('T')[0],
      cacheHits: 0,
      cacheMisses: 0
    });
    // 词汇列表存储在 local 中，避免 sync 的 8KB 限制
    chrome.storage.local.set({ learnedWords: [], memorizeList: [] });
  }
  
  // 更新时迁移：将 sync 中的词汇列表迁移到 local
  if (details.reason === 'update') {
    chrome.storage.sync.get(['learnedWords', 'memorizeList'], (syncResult) => {
      chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        const updates = {};
        const toRemove = [];
        
        // 迁移 learnedWords
        if (syncResult.learnedWords && syncResult.learnedWords.length > 0) {
          const localWords = localResult.learnedWords || [];
          const mergedMap = new Map();
          [...localWords, ...syncResult.learnedWords].forEach(w => {
            const key = w.original || w.word;
            if (!mergedMap.has(key)) mergedMap.set(key, w);
          });
          updates.learnedWords = Array.from(mergedMap.values());
          toRemove.push('learnedWords');
        }
        
        // 迁移 memorizeList
        if (syncResult.memorizeList && syncResult.memorizeList.length > 0) {
          const localList = localResult.memorizeList || [];
          const mergedMap = new Map();
          [...localList, ...syncResult.memorizeList].forEach(w => {
            if (!mergedMap.has(w.word)) mergedMap.set(w.word, w);
          });
          updates.memorizeList = Array.from(mergedMap.values());
          toRemove.push('memorizeList');
        }
        
        if (Object.keys(updates).length > 0) {
          chrome.storage.local.set(updates, () => {
            chrome.storage.sync.remove(toRemove, () => {
              console.log('[VocabMeld] Migrated word lists from sync to local');
            });
          });
        }
      });
    });
  }
  
  // 创建右键菜单
  createContextMenus();
});

// 创建右键菜单
function createContextMenus() {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: 'vocabmeld-add-memorize',
      title: '添加到需记忆列表',
      contexts: ['selection']
    });
    
    chrome.contextMenus.create({
      id: 'vocabmeld-process-page',
      title: '处理当前页面',
      contexts: ['page']
    });
  });
}

// 右键菜单点击处理
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === 'vocabmeld-add-memorize' && info.selectionText) {
    const word = info.selectionText.trim();
    if (word && word.length < 50) {
      chrome.storage.local.get('memorizeList', (result) => {
        const list = result.memorizeList || [];
        if (!list.some(w => w.word === word)) {
          list.push({ word, addedAt: Date.now() });
          chrome.storage.local.set({ memorizeList: list }, () => {
            // 通知 content script 处理特定单词
            chrome.tabs.sendMessage(tab.id, { 
              action: 'processSpecificWords', 
              words: [word] 
            }).catch(err => {
              console.log('[VocabMeld] Content script not ready, word will be processed on next page load');
            });
          });
        }
      });
    }
  }
  
  if (info.menuItemId === 'vocabmeld-process-page') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 快捷键处理
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === 'toggle-translation') {
    chrome.tabs.sendMessage(tab.id, { action: 'processPage' });
  }
});

// 消息处理
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // 语音合成
  if (message.action === 'speak') {
    const text = message.text;
    const lang = message.lang || 'en-US';
    
    // 获取用户配置的语音设置
    chrome.storage.sync.get(['ttsRate', 'ttsVoice'], (settings) => {
      const rate = settings.ttsRate || 1.0;
      const preferredVoice = settings.ttsVoice || '';
      
      // 先停止之前的朗读
      chrome.tts.stop();
      
      const options = {
        lang: lang,
        rate: rate,
        pitch: 1.0
      };
      
      // 如果用户指定了声音，使用用户的选择
      if (preferredVoice) {
        options.voiceName = preferredVoice;
      }
      
      chrome.tts.speak(text, options, () => {
        if (chrome.runtime.lastError) {
          console.error('[VocabMeld] TTS Error:', chrome.runtime.lastError.message);
          sendResponse({ success: false, error: chrome.runtime.lastError.message });
        } else {
          sendResponse({ success: true });
        }
      });
    });
    
    return true;
  }
  
  // 获取可用的 TTS 声音列表
  if (message.action === 'getVoices') {
    chrome.tts.getVoices((voices) => {
      sendResponse({ voices: voices || [] });
    });
    return true;
  }
  
  // 测试 API 连接
  if (message.action === 'testApi') {
    testApiConnection(message.endpoint, message.apiKey, message.model, message.apiProtocol, message.reasoningEffort)
      .then(result => sendResponse(result))
      .catch(error => sendResponse({ success: false, message: error.message }));
    return true;
  }
  
  if (message.action === 'llmRequest') {
    (async () => {
      try {
        const messages = message.messages;
        if (!Array.isArray(messages) || messages.length === 0) {
          sendResponse({ success: false, error: '请求参数无效' });
          return;
        }

        const config = await new Promise((resolve) => {
          chrome.storage.sync.get(['apiEndpoint', 'apiKey', 'modelName', 'apiProtocol', 'reasoningEffort'], (result) => {
            resolve(result);
          });
        });

        const apiEndpoint = config.apiEndpoint;
        const apiKey = config.apiKey;
        const modelName = config.modelName;
        const apiProtocol = config.apiProtocol || 'openai_compatible';
        const reasoningEffort = config.reasoningEffort;

        if (!apiEndpoint || !apiKey || !modelName) {
          sendResponse({ success: false, error: 'API 未配置' });
          return;
        }

        const requestBody = (() => {
          const temperature = typeof message.temperature === 'number' ? message.temperature : 0.3;
          const maxTokens = typeof message.maxTokens === 'number' ? message.maxTokens : 2000;

          if (apiProtocol === 'openai_responses') {
            const input = buildResponsesApiInput(messages);
            const effort = typeof reasoningEffort === 'string' ? reasoningEffort.trim() : '';
            return {
              model: modelName,
              input,
              temperature,
              max_output_tokens: maxTokens,
              ...(effort ? { reasoning: { effort } } : {})
            };
          }

          return {
            model: modelName,
            messages,
            temperature,
            max_tokens: maxTokens
          };
        })();

        const response = await fetch(apiEndpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`
          },
          body: JSON.stringify(requestBody)
        });

        if (!response.ok) {
          const errorMessage = await extractErrorMessageFromResponse(response);
          sendResponse({ success: false, error: errorMessage, status: response.status });
          return;
        }

        const data = apiProtocol === 'openai_responses'
          ? await parseResponsesApiResponse(response)
          : await response.json();
        const normalizedData = apiProtocol === 'openai_responses'
          ? normalizeResponsesApiToChatCompletions(data)
          : data;
        sendResponse({ success: true, data: normalizedData });
      } catch (error) {
        sendResponse({ success: false, error: error.message || String(error) });
      }
    })();

    return true;
  }

  // 发送 API 请求（避免 CORS 问题）
  if (message.action === 'apiRequest') {
    callApi(message.endpoint, message.apiKey, message.body)
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // 通用 fetch 代理（用于第三方 API，避免 CORS）
  if (message.action === 'fetchProxy') {
    fetch(message.url)
      .then(response => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        return response.json();
      })
      .then(data => sendResponse({ success: true, data }))
      .catch(error => sendResponse({ success: false, error: error.message }));
    return true;
  }
  
  // 获取统计数据
  if (message.action === 'getStats') {
    chrome.storage.sync.get([
      'totalWords', 'todayWords', 'lastResetDate',
      'cacheHits', 'cacheMisses'
    ], (syncResult) => {
      // 从 local 获取词汇列表
      chrome.storage.local.get(['learnedWords', 'memorizeList'], (localResult) => {
        // 检查是否需要重置今日统计
        const today = new Date().toISOString().split('T')[0];
        if (syncResult.lastResetDate !== today) {
          syncResult.todayWords = 0;
          syncResult.lastResetDate = today;
          chrome.storage.sync.set({ todayWords: 0, lastResetDate: today });
        }
        
        sendResponse({
          totalWords: syncResult.totalWords || 0,
          todayWords: syncResult.todayWords || 0,
          learnedCount: (localResult.learnedWords || []).length,
          memorizeCount: (localResult.memorizeList || []).length,
          cacheHits: syncResult.cacheHits || 0,
          cacheMisses: syncResult.cacheMisses || 0
        });
      });
    });
    return true;
  }
  
  // 获取缓存统计
  if (message.action === 'getCacheStats') {
    chrome.storage.sync.get('cacheMaxSize', (syncResult) => {
      const maxSize = syncResult.cacheMaxSize || 2000;
      chrome.storage.local.get('vocabmeld_word_cache', (result) => {
        const cache = result.vocabmeld_word_cache || [];
        sendResponse({
          size: cache.length,
          maxSize: maxSize
        });
      });
    });
    return true;
  }
  
  // 清空缓存
  if (message.action === 'clearCache') {
    chrome.storage.local.remove('vocabmeld_word_cache', () => {
      chrome.storage.sync.set({ cacheHits: 0, cacheMisses: 0 }, () => {
        sendResponse({ success: true });
      });
    });
    return true;
  }
  
  // 清空已学会词汇
  if (message.action === 'clearLearnedWords') {
    chrome.storage.local.set({ learnedWords: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
  
  // 清空需记忆列表
  if (message.action === 'clearMemorizeList') {
    chrome.storage.local.set({ memorizeList: [] }, () => {
      sendResponse({ success: true });
    });
    return true;
  }
});

async function extractErrorMessageFromResponse(response) {
  try {
    const rawText = await response.text().catch(() => '');
    const text = rawText.length > 2000 ? `${rawText.slice(0, 2000)}...` : rawText;

    let parsed = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch (e) {
        parsed = null;
      }
    }

    const message = parsed?.error?.message || parsed?.message || text || response.statusText || '';
    return message ? `HTTP ${response.status}: ${message}` : `HTTP ${response.status}`;
  } catch (e) {
    return `HTTP ${response.status}`;
  }
}

function isEventStreamResponse(response) {
  const contentType = response?.headers?.get('Content-Type') || '';
  return typeof contentType === 'string' && contentType.toLowerCase().includes('text/event-stream');
}

async function parseResponsesApiResponse(response) {
  if (isEventStreamResponse(response)) {
    return readResponsesApiSse(response);
  }
  return response.json();
}

async function readResponsesApiSse(response) {
  const reader = response.body?.getReader?.();
  if (!reader) {
    throw new Error('SSE 响应体为空');
  }

  const decoder = new TextDecoder('utf-8');
  let buffer = '';
  let currentEvent = '';
  let dataLines = [];
  const partsWithDelta = new Set();
  let sawAnyDelta = false;
  let outputText = '';
  let completedResponse = null;
  let errorMessage = '';
  let shouldStop = false;

  const flushEvent = () => {
    const dataStr = dataLines.join('\n').trim();
    const eventName = currentEvent;
    currentEvent = '';
    dataLines = [];

    if (!dataStr) {
      return;
    }

    if (dataStr === '[DONE]') {
      shouldStop = true;
      return;
    }

    let payload = null;
    try {
      payload = JSON.parse(dataStr);
    } catch (e) {
      payload = null;
    }

    const type = payload?.type;
    const name = eventName || type || '';

    if (name === 'response.output_text.delta') {
      const delta = payload?.delta;
      if (typeof delta === 'string') {
        outputText += delta;
        sawAnyDelta = true;
        const key = `${payload?.item_id || ''}:${String(payload?.content_index ?? '')}`;
        if (key !== ':') {
          partsWithDelta.add(key);
        }
      }
      return;
    }

    if (name === 'response.output_text.done') {
      const text = payload?.text;
      if (typeof text === 'string') {
        const key = `${payload?.item_id || ''}:${String(payload?.content_index ?? '')}`;
        const hasKey = key !== ':';
        const seenDelta = hasKey ? partsWithDelta.has(key) : sawAnyDelta;
        if (!seenDelta) {
          outputText += text;
        }
      }
      return;
    }

    if (name === 'response.completed') {
      if (payload?.response && typeof payload.response === 'object') {
        completedResponse = payload.response;
      }
      shouldStop = true;
      return;
    }

    if (name === 'error') {
      const err = payload?.error;
      if (typeof err?.message === 'string' && err.message.trim()) {
        errorMessage = err.message.trim();
      } else if (typeof payload?.message === 'string' && payload.message.trim()) {
        errorMessage = payload.message.trim();
      } else {
        errorMessage = 'SSE 返回 error 事件';
      }
      shouldStop = true;
    }
  };

  while (!shouldStop) {
    const { value, done } = await reader.read();
    if (done) {
      break;
    }

    buffer += decoder.decode(value, { stream: true });

    let newlineIndex = buffer.indexOf('\n');
    while (newlineIndex !== -1) {
      let line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (line.endsWith('\r')) {
        line = line.slice(0, -1);
      }

      if (line === '') {
        flushEvent();
        if (shouldStop) {
          break;
        }
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      if (line.startsWith('event:')) {
        currentEvent = line.slice(6).trim();
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice(5).trimStart());
        newlineIndex = buffer.indexOf('\n');
        continue;
      }

      newlineIndex = buffer.indexOf('\n');
    }
  }

  flushEvent();

  if (errorMessage) {
    throw new Error(errorMessage);
  }

  const base = completedResponse && typeof completedResponse === 'object' ? completedResponse : {};
  const text = outputText || extractResponsesApiText(base);
  return { ...base, output_text: text };
}

// 通用 API 调用（从 background 发起，避免 CORS）
async function callApi(endpoint, apiKey, body) {
  const headers = { 'Content-Type': 'application/json' };
  if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

  const response = await fetch(endpoint, {
    method: 'POST',
    headers,
    body: JSON.stringify(body)
  });

  if (!response.ok) {
    const errorMessage = await extractErrorMessageFromResponse(response);
    throw new Error(errorMessage || `HTTP ${response.status}`);
  }

  return response.json();
}

// 测试 API 连接
async function testApiConnection(endpoint, apiKey, model, apiProtocol = 'openai_compatible', reasoningEffort = '') {
  try {
    const requestBody = apiProtocol === 'openai_responses'
      ? {
        model,
        input: [{ role: 'user', content: 'Say OK' }],
        max_output_tokens: 10,
        ...(typeof reasoningEffort === 'string' && reasoningEffort.trim()
          ? { reasoning: { effort: reasoningEffort.trim() } }
          : {})
      }
      : {
        model: model,
        messages: [{ role: 'user', content: 'Say OK' }],
        max_tokens: 10
      };

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['Authorization'] = `Bearer ${apiKey}`;

    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
      const errorMessage = await extractErrorMessageFromResponse(response);
      throw new Error(errorMessage || `HTTP ${response.status}`);
    }

    const data = apiProtocol === 'openai_responses'
      ? await parseResponsesApiResponse(response)
      : await response.json();
    if (apiProtocol === 'openai_responses') {
      const outputText = extractResponsesApiText(data);
      if (outputText) {
        return { success: true, message: '连接成功！' };
      }
      throw new Error('Invalid response');
    }

    if (data.choices && data.choices[0]) {
      return { success: true, message: '连接成功！' };
    }

    throw new Error('Invalid response');
  } catch (error) {
    return { success: false, message: error.message };
  }
}

function buildResponsesApiInput(messages) {
  const inputMessages = [];

  if (!Array.isArray(messages)) {
    return [];
  }

  for (const msg of messages) {
    if (!msg || typeof msg !== 'object') continue;

    const role = msg.role;
    const content = msg.content;
    if (typeof role === 'string') {
      inputMessages.push({ role: normalizeResponsesApiRole(role), content });
    }
  }

  return inputMessages;
}

function normalizeResponsesApiRole(role) {
  if (role === 'system') {
    return 'developer';
  }
  return role;
}

function extractResponsesApiText(data) {
  if (!data || typeof data !== 'object') {
    return '';
  }

  if (typeof data.output_text === 'string' && data.output_text) {
    return data.output_text;
  }

  if (!Array.isArray(data.output)) {
    return '';
  }

  const texts = [];
  for (const item of data.output) {
    if (!item || typeof item !== 'object') continue;
    if (item.type !== 'message') continue;
    if (!Array.isArray(item.content)) continue;

    for (const part of item.content) {
      if (!part || typeof part !== 'object') continue;
      if (part.type !== 'output_text') continue;
      if (typeof part.text !== 'string') continue;
      texts.push(part.text);
    }
  }

  return texts.join('');
}

function normalizeResponsesApiToChatCompletions(data) {
  const content = extractResponsesApiText(data);
  return {
    ...data,
    choices: [
      {
        message: {
          role: 'assistant',
          content
        }
      }
    ]
  };
}

// 扩展图标点击（如果没有 popup）
chrome.action.onClicked.addListener((tab) => {
  // 由于我们有 popup，这个不会被触发
  // 但保留以防万一
});

// 标签页更新时检查是否需要注入脚本
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status === 'complete' && tab.url?.startsWith('http')) {
    // 可以在这里做额外的初始化
  }
});

console.log('[VocabMeld] Background script loaded');
